// The storage chapter draws the schema Postgres reports, and every table in it
// is placed and explained: a new migration's table can't be left off the diagram.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCHEMA, TABLE_INFO, fkColumns, indexKind } from './schema';

const MIGRATIONS = path.resolve(import.meta.dirname, '../../../../../sql/migrations');

describe('schema chapter data', () => {
  it('was read after every migration in the repo', () => {
    expect(SCHEMA.migrations).toEqual(
      readdirSync(MIGRATIONS)
        .filter((f) => f.endsWith('.sql'))
        .sort(),
    );
  });

  it('places and explains every table, and nothing else', () => {
    expect(Object.keys(TABLE_INFO).sort()).toEqual(SCHEMA.tables.map((t) => t.name).sort());
  });

  it('has the indexes the engine depends on', () => {
    const all = SCHEMA.tables.flatMap((t) => t.indexes.map((i) => indexKind(i.definition).label));
    expect(all.filter((l) => l === 'HNSW')).toHaveLength(3);
    expect(all.filter((l) => l === 'GIN full text')).toHaveLength(2);
    const facts = SCHEMA.tables.find((t) => t.name === 'facts');
    expect(facts?.indexes.some((i) => /WHERE \(invalidated_at IS NULL\)/.test(i.definition))).toBe(
      true,
    );
  });

  it('reads foreign-key columns, and every key points at a table in the schema', () => {
    expect(fkColumns('FOREIGN KEY (subject_id) REFERENCES entities(id)')).toEqual(['subject_id']);
    const names = new Set(SCHEMA.tables.map((t) => t.name));
    for (const t of SCHEMA.tables)
      for (const c of t.constraints.filter((k) => k.kind === 'foreign')) {
        expect(names.has(c.references ?? '')).toBe(true);
        expect(fkColumns(c.definition).length).toBeGreaterThan(0);
      }
  });
});
