import { describe, expect, it } from 'vitest';
import { galaxyTexts, project } from './galaxy.js';

describe('galaxy', () => {
  it('collects dev-long turns and recalled facts, each once', () => {
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
