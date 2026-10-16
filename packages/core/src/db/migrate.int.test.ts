import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Sql } from './client.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DATABASE_URL, createDb } from './client.js';
import { migrate } from './migrate.js';
import type { MigrationSource } from './migrate.js';

const url = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;

// Each test gets a scratch schema and its own migration directories, so the
// runner is exercised without touching the real `engram` schema.
let sql: Sql;
let schema: string;
let work: string;

beforeEach(async () => {
  sql = createDb(url, { max: 1 });
  schema = `migrate_test_${randomUUID().slice(0, 8)}`;
  work = await mkdtemp(path.join(tmpdir(), 'engram-migrate-'));
});

afterEach(async () => {
  await sql`drop schema if exists ${sql(schema)} cascade`;
  await sql.end();
  await rm(work, { recursive: true, force: true });
});

async function source(prefix: string, files: Record<string, string>): Promise<MigrationSource> {
  const dir = path.join(work, prefix);
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(dir, name), content);
  }
  return { dir, prefix };
}

async function tables(): Promise<string[]> {
  const rows = await sql<{ name: string }[]>`
    select table_name as name from information_schema.tables
    where table_schema = ${schema} and table_name <> 'schema_migrations'
    order by table_name`;
  return rows.map((r) => r.name);
}

async function recorded(): Promise<string[]> {
  const rows = await sql<{ filename: string }[]>`
    select filename from ${sql(schema)}.schema_migrations order by filename`;
  return rows.map((r) => r.filename);
}

describe('migrate', () => {
  it('applies files in lexical order and records them', async () => {
    const src = await source('migrations', {
      // 0002 depends on 0001, so out-of-order application would fail.
      '0002_child.sql': `create table ${schema}.child (parent_id int references ${schema}.parent(id));`,
      '0001_parent.sql': `create table ${schema}.parent (id int primary key);`,
    });

    const applied = await migrate(sql, { sources: [src], trackingSchema: schema });

    expect(applied).toEqual(['migrations/0001_parent.sql', 'migrations/0002_child.sql']);
    expect(await tables()).toEqual(['child', 'parent']);
    expect(await recorded()).toEqual(applied);
  });

  it('is a no-op when re-run', async () => {
    const src = await source('migrations', { '0001_a.sql': `create table ${schema}.a (id int);` });
    await migrate(sql, { sources: [src], trackingSchema: schema });

    expect(await migrate(sql, { sources: [src], trackingSchema: schema })).toEqual([]);
  });

  it('fails when an applied file has changed, and applies nothing', async () => {
    const src = await source('migrations', { '0001_a.sql': `create table ${schema}.a (id int);` });
    await migrate(sql, { sources: [src], trackingSchema: schema });
    await writeFile(path.join(src.dir, '0001_a.sql'), `create table ${schema}.a (id bigint);`);
    await writeFile(path.join(src.dir, '0002_b.sql'), `create table ${schema}.b (id int);`);

    await expect(migrate(sql, { sources: [src], trackingSchema: schema })).rejects.toThrow(
      /0001_a\.sql has changed/,
    );
    expect(await tables()).toEqual(['a']);
  });

  it('fails when an applied file is missing on disk', async () => {
    const src = await source('migrations', { '0001_a.sql': `create table ${schema}.a (id int);` });
    await migrate(sql, { sources: [src], trackingSchema: schema });
    await rm(path.join(src.dir, '0001_a.sql'));

    await expect(migrate(sql, { sources: [src], trackingSchema: schema })).rejects.toThrow(
      /missing on disk/,
    );
  });

  it('rolls back a failing file and keeps earlier ones', async () => {
    const src = await source('migrations', {
      '0001_ok.sql': `create table ${schema}.ok (id int);`,
      '0002_bad.sql': `create table ${schema}.half (id int); select no_such_function();`,
    });

    await expect(migrate(sql, { sources: [src], trackingSchema: schema })).rejects.toThrow();
    expect(await tables()).toEqual(['ok']);
    expect(await recorded()).toEqual(['migrations/0001_ok.sql']);
  });

  it('applies sources in the order given and prefixes their names', async () => {
    const portable = await source('migrations', {
      '0001_base.sql': `create table ${schema}.base (id int primary key);`,
    });
    const hosted = await source('hosted', {
      '0001_extra.sql': `create table ${schema}.extra (base_id int references ${schema}.base(id));`,
    });

    const applied = await migrate(sql, { sources: [portable, hosted], trackingSchema: schema });

    expect(applied).toEqual(['migrations/0001_base.sql', 'hosted/0001_extra.sql']);
  });

  it('ignores applied rows from sources not in this run', async () => {
    const portable = await source('migrations', {
      '0001_base.sql': `create table ${schema}.base (id int);`,
    });
    const hosted = await source('hosted', { '0001_extra.sql': `select 1;` });
    await migrate(sql, { sources: [portable, hosted], trackingSchema: schema });

    // A plain `db:migrate` against a hosted database must not trip over `hosted/` rows.
    expect(await migrate(sql, { sources: [portable], trackingSchema: schema })).toEqual([]);
  });

  it('applies each file exactly once under concurrent runners', async () => {
    const files: Record<string, string> = {};
    for (let i = 1; i <= 5; i++) {
      files[`000${i}_t.sql`] = `create table ${schema}.t${i} (id int);`;
    }
    const src = await source('migrations', files);
    const other = createDb(url, { max: 1 });
    try {
      const results = await Promise.all([
        migrate(sql, { sources: [src], trackingSchema: schema }),
        migrate(other, { sources: [src], trackingSchema: schema }),
      ]);
      expect(results.flat().sort()).toEqual(Object.keys(files).map((f) => `migrations/${f}`));
    } finally {
      await other.end();
    }
  });
});
