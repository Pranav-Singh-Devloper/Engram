import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Sql } from './client.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_DATABASE_URL, createDb } from './client.js';
import { HOSTED, PORTABLE, migrate } from './migrate.js';

const url = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
let sql: Sql;

beforeAll(async () => {
  sql = createDb(url, { max: 1 });
  // Same call as `pnpm db:migrate`; a no-op if the database is already current.
  await migrate(sql, { sources: [PORTABLE] });
});

afterAll(async () => {
  await sql.end();
});

describe('portable migrations', () => {
  it('create the engram and extensions schemas', async () => {
    const rows = await sql<{ nspname: string }[]>`
      select nspname from pg_namespace where nspname in ('engram', 'extensions') order by 1`;
    expect(rows.map((r) => r.nspname)).toEqual(['engram', 'extensions']);
  });

  it('install pgvector into the extensions schema', async () => {
    const [row] = await sql<{ schema: string }[]>`
      select extnamespace::regnamespace::text as schema from pg_extension where extname = 'vector'`;
    expect(row?.schema).toBe('extensions');
  });

  it('resolve the vector type through the connection search_path', async () => {
    const [row] = await sql<{ v: string; d: number }[]>`
      select '[1,2,3]'::vector::text as v, '[0,0,0]'::vector <-> '[3,4,0]'::vector as d`;
    expect(row).toEqual({ v: '[1,2,3]', d: 5 });
  });

  it('never touch supabase/hosted', async () => {
    const rows = await sql`
      select 1 from engram.schema_migrations where filename like 'hosted/%'`;
    expect(rows).toHaveLength(0);
  });
});

describe('hosted revoke SQL', () => {
  // The Supabase API roles don't exist locally, so the test creates them,
  // applies the hosted file and inspects privileges inside a transaction
  // that is always rolled back.
  it('leaves anon and authenticated with no access to engram', async () => {
    const hostedSql = await readFile(path.join(HOSTED.dir, '0001_revoke_api_roles.sql'), 'utf8');
    const rollback = new Error('rollback');

    const result = sql.begin(async (tx) => {
      for (const role of ['anon', 'authenticated']) {
        const [exists] = await tx`select 1 from pg_roles where rolname = ${role}`;
        if (!exists) await tx`create role ${tx(role)} nologin`;
      }
      // Simulate grants Supabase or a careless migration might have made.
      await tx`grant usage on schema engram to anon, authenticated`;
      await tx`create table engram.revoke_probe (id int)`;
      await tx`grant select on engram.revoke_probe to anon`;
      await tx`create function engram.revoke_probe_fn() returns int language sql as 'select 1'`;

      await tx.unsafe(hostedSql);

      await tx`create table engram.revoke_probe_later (id int)`;
      const [p] = await tx<Record<string, boolean>[]>`
        select
          has_schema_privilege('anon', 'engram', 'USAGE') as anon_usage,
          has_schema_privilege('authenticated', 'engram', 'USAGE') as auth_usage,
          has_table_privilege('anon', 'engram.revoke_probe', 'SELECT') as anon_select,
          has_table_privilege('anon', 'engram.revoke_probe_later', 'SELECT') as anon_select_later,
          has_function_privilege('anon', 'engram.revoke_probe_fn()', 'EXECUTE') as anon_execute`;
      expect(p).toEqual({
        anonUsage: false,
        authUsage: false,
        anonSelect: false,
        anonSelectLater: false,
        anonExecute: false,
      });
      throw rollback;
    });

    await expect(result).rejects.toBe(rollback);
  });
});
