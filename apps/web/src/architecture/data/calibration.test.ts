// The resolution chapter's threshold slider counts errors the way
// bench:calibrate does, and its marked thresholds are the engine's profiles.
import { SIMILARITY_PROFILES } from '@engram/core';
import { describe, expect, it } from 'vitest';
import { CALIBRATIONS, FAMILY_NAMES, PROFILES, errorsAt, modelOf } from './calibration';

describe('calibration chapter data', () => {
  it('covers both embedders, with per-pair scores for Gemini', () => {
    expect(CALIBRATIONS.map((c) => modelOf(c.space)).sort()).toEqual([
      'embeddinggemma:300m',
      'gemini-embedding-2',
    ]);
    expect(CALIBRATIONS.find((c) => c.space === 'gemini-embedding-2')?.scores).not.toBeNull();
  });

  it('reproduces the calibration summary’s error rates from the per-pair scores', () => {
    for (const c of CALIBRATIONS) {
      if (!c.scores) continue;
      for (const f of FAMILY_NAMES) {
        const s = c.scores[f];
        const sum = c.families[f];
        expect(s.positive.length).toBe(sum.positives);
        expect(s.negative.length).toBe(sum.negatives);
        const e = errorsAt(s, sum.current.threshold);
        expect(e.falsePositive, f).toBeCloseTo(sum.current.falsePositive, 3);
        expect(e.falseNegative, f).toBeCloseTo(sum.current.falseNegative, 3);
      }
    }
  });

  it('marks the thresholds the engine actually uses', () => {
    expect(PROFILES).toEqual({
      'gemini-embedding-2': SIMILARITY_PROFILES['gemini-embedding-2'],
      'embeddinggemma:300m': SIMILARITY_PROFILES['embeddinggemma:300m'],
    });
    // Gemini's calibration was run at its own profile, so "current" is the profile.
    const gemini = CALIBRATIONS.find((c) => c.space === 'gemini-embedding-2');
    for (const f of FAMILY_NAMES) {
      expect(gemini?.families[f].current.threshold, f).toBe(PROFILES['gemini-embedding-2']?.[f]);
    }
  });
});
