import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REFERENCES } from '@/content/references';
import { SYSTEMS } from './data/prior-art';

const DIR = path.resolve(import.meta.dirname);
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory()
      ? sources(path.join(dir, d.name))
      : /\.tsx?$/.test(d.name) && !d.name.endsWith('.test.ts')
        ? [path.join(dir, d.name)]
        : [],
  );
// Literal citations, plus the prior-art matrix, which cites each compared
// system on its row (<Cite k={s.ref} />).
const cited = new Set([
  ...sources(DIR).flatMap((f) =>
    [...readFileSync(f, 'utf8').matchAll(/<Cite k="([^"]+)"/g)].map((m) => m[1] ?? ''),
  ),
  ...SYSTEMS.map((s) => s.ref),
]);
// One `id: '…'` line per registered chapter (Prettier puts each on its own line).
const chapters = (readFileSync(path.join(DIR, 'registry.tsx'), 'utf8').match(/^\s+id: '/gm) ?? [])
  .length;

describe('references', () => {
  const keys = REFERENCES.map((r) => r.key);

  it('are unique and every inline citation resolves to one', () => {
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of cited) expect(keys, `<Cite k="${k}">`).toContain(k);
  });

  it('link to arXiv, a DOI or an https page; only the book chapter has no URL', () => {
    for (const r of REFERENCES) {
      if (r.url === null) {
        expect(r.venue, r.key).toMatch(/Academic Press|In /);
        continue;
      }
      expect(r.url, r.key).toMatch(
        /^https:\/\/(arxiv\.org\/abs\/\d{4}\.\d{4,5}|doi\.org\/10\.\d{4,}\/\S+|[\w.-]+\/\S+)$/,
      );
      expect(r.took.length, r.key).toBeGreaterThan(40);
    }
  });

  it('are all cited once every chapter is built', () => {
    // The bibliography lists only works the page uses, once all 16 chapters exist.
    expect(chapters).toBe(16);
    for (const k of keys) expect(cited, k).toContain(k);
  });
});
