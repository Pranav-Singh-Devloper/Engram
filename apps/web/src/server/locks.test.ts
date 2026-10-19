// SPEC §6.1: only transaction-scoped advisory locks are safe behind a
// transaction-mode pooler. A session-level lock would outlive the transaction
// on a shared server connection.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const DIRS = ['packages', 'apps', 'scripts', 'sql'];

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (d.name === 'node_modules' || d.name.startsWith('.')) return [];
    const p = path.join(dir, d.name);
    return d.isDirectory() ? files(p) : /\.(ts|sql)$/.test(d.name) ? [p] : [];
  });
}

describe('advisory locks', () => {
  it('are only ever transaction-scoped', () => {
    const offenders = DIRS.flatMap((d) => files(path.join(ROOT, d))).filter((f) =>
      /pg_(try_)?advisory_lock(_shared)?\s*\(/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});
