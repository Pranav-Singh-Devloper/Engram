// The decay chapter plots core's retention score: same constants, same values.
import {
  PREDICATES,
  config,
  crossingDays as coreCrossing,
  decayedAccess as coreDecayed,
  retentionScore,
} from '@engram/core';
import { describe, expect, it } from 'vitest';
import {
  DECAY,
  STATIC_PREDICATES,
  crossingDays,
  crossingWithAccess,
  decayedAccess,
  retention,
} from './decay';
import type { Tier } from './decay';

const DAY = 86_400_000;
const NOW = new Date('2024-09-01T00:00:00Z');

describe('decay chapter data', () => {
  it('mirrors core’s decay constants and static predicates', () => {
    const { tauWorkingDays, tauLongTermDays, archiveThreshold, accessSaturation } = config.decay;
    expect(DECAY).toEqual({
      tauWorkingDays,
      tauLongTermDays,
      archiveThreshold,
      recencyWeight: config.decay.recencyWeight,
      accessWeight: config.decay.accessWeight,
      importanceWeight: config.decay.importanceWeight,
      accessSaturation,
    });
    expect(STATIC_PREDICATES).toEqual(
      PREDICATES.filter((p) => p.mutability === 'static').map((p) => p.name),
    );
  });

  it('plots exactly retentionScore across tiers, importance, access and age', () => {
    for (const tier of ['working', 'long_term'] as Tier[]) {
      for (const importance of [0, 0.3, 0.5, 0.6, 1]) {
        for (const accessScore of [0, 1, 5, 20, 80]) {
          for (const days of [0, 1, 14, 42, 90, 270, 1000]) {
            const core = retentionScore(
              {
                importance,
                accessScore,
                lastAccessedAt: new Date(NOW.getTime() - days * DAY),
                recordedAt: new Date(0),
                tier,
              },
              NOW,
            );
            expect(retention(importance, accessScore, days, tier).score).toBeCloseTo(core, 12);
          }
        }
      }
    }
  });

  it('decays the access score as the sweep does', () => {
    for (const tier of ['working', 'long_term'] as Tier[])
      for (const a of [0, 1, 7.5, 40])
        for (const d of [0, 3, 30, 400])
          expect(decayedAccess(a, d, tier)).toBe(coreDecayed(a, d, tier));
  });

  it('crosses the archive threshold when core says it does', () => {
    for (const tier of ['working', 'long_term'] as Tier[]) {
      for (const importance of [0, 0.2, 0.5, 0.59, 0.6, 0.9]) {
        expect(crossingDays(importance, tier)).toBe(coreCrossing(importance, tier));
        // With no access, the bisection agrees with the closed form.
        const bisected = crossingWithAccess(importance, 0, tier);
        if (Number.isFinite(coreCrossing(importance, tier)))
          expect(bisected).toBeCloseTo(coreCrossing(importance, tier), 6);
        else expect(bisected).toBe(Infinity);
      }
    }
    // SPEC §9.1: a 0.5-importance fact crosses after about 3τ.
    expect(crossingDays(0.5, 'working')).toBeCloseTo(42, -1);
    expect(crossingDays(0.5, 'long_term')).toBeCloseTo(270, -1);
  });
});
