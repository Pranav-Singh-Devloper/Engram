import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DATABASE_URL, createDb, textArray, uuidArray } from './client.js';

const url = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;

describe('array parameters', () => {
  it("work in a fresh connection's first query", async () => {
    // Untyped db.array() fails here: postgres.js hasn't fetched array types yet.
    const db = createDb(url, { max: 1 });
    try {
      const [row] = await db<{ t: string[]; u: string[] }[]>`
        select ${textArray(db, ['a', 'b'])}::text[] as t,
               ${uuidArray(db, ['00000000-0000-0000-0000-000000000001'])}::uuid[] as u`;
      expect(row).toEqual({ t: ['a', 'b'], u: ['00000000-0000-0000-0000-000000000001'] });
    } finally {
      await db.end();
    }
  });

  it('are always typed: no untyped db.array() in engine or MCP code', () => {
    const roots = ['..', '../../../mcp/src'].map((r) => path.resolve(import.meta.dirname, r));
    const offenders = roots.flatMap((root) =>
      (readdirSync(root, { recursive: true }) as string[])
        .filter((f) => f.endsWith('.ts') && !f.includes('.test.'))
        .filter((f) =>
          /\b(?:db|tx|sql|this\.db)\.array\(/.test(readFileSync(path.join(root, f), 'utf8')),
        )
        .map((f) => path.join(path.basename(root), f)),
    );
    expect(offenders.filter((f) => !f.endsWith(path.join('db', 'client.ts')))).toEqual([]);
  });
});
