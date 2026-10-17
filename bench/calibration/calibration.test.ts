import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { reportFamily } from './calibrate.js';
import { FAMILIES, buildPairs } from './pairs.js';

describe('the calibration pair set', () => {
  const pairs = buildPairs();

  it('covers every family with positives and negatives', () => {
    for (const family of Object.keys(FAMILIES)) {
      const mine = pairs.filter((p) => p.family === family);
      expect(
        mine.some((p) => p.positive),
        family,
      ).toBe(true);
      expect(
        mine.some((p) => !p.positive),
        family,
      ).toBe(true);
    }
    expect(pairs.length).toBeGreaterThanOrEqual(100);
  });

  it('is built from dev only, never the test split (SPEC §13.1)', () => {
    const dir = import.meta.dirname;
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      expect(readFileSync(path.join(dir, f), 'utf8'), f).not.toMatch(/test\.json|'test'/);
    }
  });
});

describe('reportFamily', () => {
  it('reports error rates at a threshold and suggests the lowest safe one', () => {
    const scored = [
      { positive: true, score: 0.95 },
      { positive: true, score: 0.9 },
      { positive: true, score: 0.8 },
      { positive: false, score: 0.85 },
      { positive: false, score: 0.5 },
    ];
    const r = reportFamily(scored, 0.9, 0);
    expect(r.current).toEqual({ threshold: 0.9, falsePositive: 0, falseNegative: 0.333 });
    // Just above the highest negative (0.85): keeps the two positives over it.
    expect(r.suggested).toEqual({ threshold: 0.851, falsePositive: 0, positivesKept: 0.667 });
    expect(r.negativeRange).toEqual([0.5, 0.85]);
  });
});
