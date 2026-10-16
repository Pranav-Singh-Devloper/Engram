import { describe, expect, it } from 'vitest';
import { EMBEDDING_DIM } from '../config/index.js';
import { cosine, fromSql, l2Normalize, toSql } from './vector.js';

const v = Array.from({ length: EMBEDDING_DIM }, (_, i) => (i % 7) / 4 - 0.5);

describe('pgvector text format', () => {
  it('round-trips', () => {
    expect(fromSql(toSql(v))).toEqual(v);
  });

  it('rejects the wrong dimension', () => {
    expect(() => toSql([1, 2, 3])).toThrow(/768-dim/);
    expect(() => fromSql('[1,2,3]')).toThrow(/768-dim/);
  });

  it('rejects non-finite values', () => {
    expect(() => toSql([...v.slice(1), Number.NaN])).toThrow(/non-finite/);
    expect(() => toSql([...v.slice(1), Infinity])).toThrow(/non-finite/);
  });

  it('rejects text that is not a vector', () => {
    expect(() => fromSql('{"a":1}')).toThrow(/Not a pgvector/);
  });
});

describe('l2Normalize and cosine', () => {
  it('produces a unit vector in the same direction', () => {
    const n = l2Normalize([3, 4]);
    expect(n).toEqual([0.6, 0.8]);
    expect(cosine(n, [3, 4])).toBeCloseTo(1);
  });

  it('refuses the zero vector', () => {
    expect(() => l2Normalize([0, 0])).toThrow(/zero vector/);
  });

  it('is 0 for orthogonal vectors and -1 for opposite ones', () => {
    expect(cosine([1, 0], [0, 2])).toBe(0);
    expect(cosine([1, 1], [-2, -2])).toBeCloseTo(-1);
  });
});
