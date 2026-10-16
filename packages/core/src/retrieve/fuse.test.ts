import { describe, expect, it } from 'vitest';
import { UNKNOWN_START } from '../db/client.js';
import { minMax, recency, rrf, withPriors } from './fuse.js';

describe('rrf', () => {
  it('ranks a key found by several lists above one found by a single list', () => {
    const scores = rrf([['a', 'b'], ['c', 'a'], ['a']], 60);
    expect(scores.get('a')).toBeGreaterThan(scores.get('b') ?? 0);
    expect(scores.get('a')).toBeGreaterThan(scores.get('c') ?? 0);
    expect(scores.get('b')).toBeCloseTo(1 / 62, 10);
  });

  it('prefers a higher rank within one list', () => {
    const scores = rrf([['x', 'y']], 60);
    expect(scores.get('x')).toBeGreaterThan(scores.get('y') ?? 0);
  });
});

describe('priors', () => {
  const validAt = new Date('2024-09-01T00:00:00Z');

  it('decays recency over the scale, and gives unknown starts nothing', () => {
    expect(recency(validAt, validAt, 30)).toBe(1);
    expect(recency(new Date('2024-08-02T00:00:00Z'), validAt, 30)).toBeCloseTo(Math.exp(-1), 5);
    expect(recency(UNKNOWN_START, validAt, 30)).toBe(0);
    expect(recency(null, validAt, 30)).toBe(0);
    // Something that starts after the valid time asked about isn't "older".
    expect(recency(new Date('2025-01-01T00:00:00Z'), validAt, 30)).toBe(1);
  });

  it('only nudges: priors break ties without overturning a clear lead', () => {
    const w = { recency: 0.1, importance: 0.1 };
    const fresh = withPriors(0.01, { recency: 1, importance: 1 }, w);
    const stale = withPriors(0.01, { recency: 0, importance: 0 }, w);
    expect(fresh).toBeGreaterThan(stale);
    expect(withPriors(0.02, { recency: 0, importance: 0 }, w)).toBeGreaterThan(fresh);
  });
});

describe('minMax', () => {
  it('scales to [0, 1] and maps a constant to 1', () => {
    expect(minMax([2, 4, 6])).toEqual([0, 0.5, 1]);
    expect(minMax([3, 3])).toEqual([1, 1]);
  });
});
