import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FACT_RUN, galaxyTexts, project } from './galaxy.js';

// The recalled facts come from a run directory, and bench/runs/ is gitignored,
// so CI and fresh clones skip this case. The committed galaxy.json it produced
// is still checked there (apps/web src/architecture/data/galaxy.test.ts).
const hasRun = existsSync(path.resolve(import.meta.dirname, '../runs', FACT_RUN, 'engram'));

describe('galaxy', () => {
  it.skipIf(!hasRun)('collects dev-long turns and recalled facts, each once', () => {
    const t = galaxyTexts();
    expect(new Set(t.map((x) => x.text)).size).toBe(t.length);
    expect(t.some((x) => x.kind === 'story')).toBe(true);
    expect(t.some((x) => x.kind === 'filler')).toBe(true);
    expect(t.some((x) => x.kind === 'fact')).toBe(true);
  });

  it('projects deterministically into a unit ball, one point per vector', () => {
    const vecs = Array.from({ length: 40 }, (_, i) =>
      Array.from({ length: 8 }, (_, d) => Math.sin(i * (d + 1))),
    );
    const a = project(vecs, 3);
    expect(a).toHaveLength(40);
    expect(project(vecs, 3)).toEqual(a);
    expect(Math.max(...a.map((p) => Math.hypot(...p)))).toBeLessThanOrEqual(1.0001);
  });
});
