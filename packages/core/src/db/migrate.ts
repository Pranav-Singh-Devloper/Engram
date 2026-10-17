import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { SEARCH_PATH } from './client.js';
import type { Sql } from './client.js';

export interface MigrationSource {
  /** Directory of `*.sql` files, applied in lexical order. */
  dir: string;
  /** Recorded with each filename so files from different sources can't collide. */
  prefix: string;
}

const SUPABASE_DIR = path.resolve(import.meta.dirname, '../../../../supabase');

/** Portable SQL, applied to every database (SPEC §3). */
export const PORTABLE: MigrationSource = {
  dir: path.join(SUPABASE_DIR, 'migrations'),
  prefix: 'migrations',
};

/** Supabase-only SQL (pg_cron, role revokes), applied only by `db:migrate:hosted`. */
export const HOSTED: MigrationSource = {
  dir: path.join(SUPABASE_DIR, 'hosted'),
  prefix: 'hosted',
};

/**
 * A Flyway-style repeatable file (`R__*.sql`): re-applied whenever its content
 * changes, after the numbered files (lexical order puts it last). Its SQL must
 * be idempotent. Generated files, such as the pg_cron schedules, use it.
 */
export function isRepeatable(name: string): boolean {
  return path.basename(name).startsWith('R__');
}

export interface Migration {
  name: string;
  sql: string;
  checksum: string;
}

export interface MigrateOptions {
  /** Applied in the order given: portable migrations before hosted-only SQL. */
  sources: readonly MigrationSource[];
  /** Schema holding the `schema_migrations` tracking table. */
  trackingSchema?: string;
  log?: (message: string) => void;
}

interface AppliedRow {
  filename: string;
  checksum: string;
}

// Transaction-scoped so it is safe behind a pooler (SPEC §6.1).
const LOCK = "hashtextextended('engram:migrate', 0)";

function checksum(content: string): string {
  return createHash('sha256').update(content.replace(/\r\n/g, '\n')).digest('hex');
}

export async function loadMigrations(source: MigrationSource): Promise<Migration[]> {
  const files = (await readdir(source.dir)).filter((f) => f.endsWith('.sql')).sort();
  return Promise.all(
    files.map(async (file) => {
      const sql = await readFile(path.join(source.dir, file), 'utf8');
      return { name: `${source.prefix}/${file}`, sql, checksum: checksum(sql) };
    }),
  );
}

/** Applies pending migrations, one transaction per file. Returns the names applied. */
export async function migrate(sql: Sql, options: MigrateOptions): Promise<string[]> {
  const schema = options.trackingSchema ?? 'engram';
  const log = options.log ?? (() => undefined);
  await sql.begin(async (tx) => {
    await tx.unsafe(`select pg_advisory_xact_lock(${LOCK})`);
    await tx`create schema if not exists ${tx(schema)}`;
    await tx`
      create table if not exists ${tx(schema)}.schema_migrations (
        filename   text primary key,
        checksum   text not null,
        applied_at timestamptz not null default now()
      )`;
  });

  const migrations = (await Promise.all(options.sources.map(loadMigrations))).flat();
  const prefixes = options.sources.map((s) => `${s.prefix}/`);
  const rows = await sql<AppliedRow[]>`
    select filename, checksum from ${sql(schema)}.schema_migrations`;
  // Only rows from the sources in this run: a hosted database also holds `hosted/` rows.
  const applied = new Map(
    rows
      .filter((row) => prefixes.some((p) => row.filename.startsWith(p)))
      .map((row) => [row.filename, row.checksum]),
  );

  const onDisk = new Set(migrations.map((m) => m.name));
  for (const name of applied.keys()) {
    if (!onDisk.has(name)) {
      throw new Error(`Applied migration ${name} is missing on disk.`);
    }
  }
  for (const m of migrations) {
    const recorded = applied.get(m.name);
    if (recorded !== undefined && recorded !== m.checksum && !isRepeatable(m.name)) {
      throw new Error(
        `Applied migration ${m.name} has changed on disk. Add a new migration instead of editing it.`,
      );
    }
  }

  const done: string[] = [];
  for (const m of migrations) {
    if (applied.get(m.name) === m.checksum) continue;
    const ran = await sql.begin(async (tx) => {
      await tx.unsafe(`select pg_advisory_xact_lock(${LOCK})`);
      // Another runner may have applied it while we waited for the lock.
      const [existing] = await tx<{ checksum: string }[]>`
        select checksum from ${tx(schema)}.schema_migrations where filename = ${m.name}`;
      if (existing?.checksum === m.checksum) return false;
      // Some hosts (Neon's proxy) drop the search_path startup parameter, so
      // each migration sets it itself: opclasses like vector_cosine_ops live
      // in `extensions`.
      await tx.unsafe(`set local search_path to ${SEARCH_PATH}`);
      await tx.unsafe(m.sql);
      await tx`
        insert into ${tx(schema)}.schema_migrations (filename, checksum)
        values (${m.name}, ${m.checksum})
        on conflict (filename) do update set checksum = excluded.checksum, applied_at = now()`;
      return true;
    });
    if (ran) {
      log(`applied ${m.name}`);
      done.push(m.name);
    }
  }
  return done;
}

/** Drops Engram's schemas so `migrate` rebuilds from scratch. Callers check the target is local. */
export async function dropSchemas(sql: Sql, schemas: readonly string[]): Promise<void> {
  for (const schema of schemas) {
    await sql`drop schema if exists ${sql(schema)} cascade`;
  }
}
