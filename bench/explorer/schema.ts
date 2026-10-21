// The `engram` schema as Postgres reports it after every migration (P09c
// chapter 10): tables, columns, keys, checks, indexes and functions, read from
// the catalog of the local database, so the ER diagram can't drift from SQL.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_DATABASE_URL, createDb } from '@engram/core';
import { PORTABLE, migrate } from '@engram/core/migrate';

const ROOT = path.resolve(import.meta.dirname, '../..');

export async function schemaData() {
  const db = createDb(process.env.DATABASE_URL || DEFAULT_DATABASE_URL, { max: 1 });
  try {
    await migrate(db, { sources: [PORTABLE] });
    const columns = await db<
      { table: string; name: string; type: string; nullable: boolean; default: string | null }[]
    >`
      select c.relname as table, a.attname as name,
        format_type(a.atttypid, a.atttypmod) as type,
        not a.attnotnull as nullable, pg_get_expr(d.adbin, d.adrelid) as default
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid and c.relkind = 'r'
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'engram'
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attnum > 0 and not a.attisdropped
      order by c.relname, a.attnum`;
    const constraints = await db<
      { table: string; name: string; kind: string; definition: string; references: string | null }[]
    >`
      select conrelid::regclass::text as table, conname as name, contype::text as kind,
        pg_get_constraintdef(oid) as definition,
        case when contype = 'f' then confrelid::regclass::text end as references
      from pg_constraint
      where connamespace = 'engram'::regnamespace and contype in ('p', 'f', 'u', 'c')
      order by 1, contype, conname`;
    const indexes = await db<{ table: string; name: string; definition: string }[]>`
      select tablename as table, indexname as name, indexdef as definition
      from pg_indexes where schemaname = 'engram' order by 1, 2`;
    const functions = await db<{ name: string; args: string }[]>`
      select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p where p.pronamespace = 'engram'::regnamespace order by 1`;
    const strip = (s: string) => s.replace(/^engram\./, '');
    const tables = [...new Set(columns.map((c) => c.table))].sort();
    return {
      migrations: readdirSync(path.join(ROOT, 'sql/migrations'))
        .filter((f) => f.endsWith('.sql'))
        .sort(),
      functions,
      tables: tables.map((t) => ({
        name: t,
        columns: columns
          .filter((c) => c.table === t)
          .map(({ name, type, nullable, default: def }) => ({
            name,
            type,
            nullable,
            default: def,
          })),
        constraints: constraints
          .filter((c) => strip(c.table) === t)
          .map((c) => ({
            name: c.name,
            kind: { p: 'primary', f: 'foreign', u: 'unique', c: 'check' }[c.kind] ?? c.kind,
            definition: c.definition,
            references: c.references ? strip(c.references) : null,
          })),
        indexes: indexes
          .filter((i) => i.table === t)
          .map((i) => ({ name: i.name, definition: i.definition.replace(/engram\./g, '') })),
      })),
    };
  } finally {
    await db.end();
  }
}
