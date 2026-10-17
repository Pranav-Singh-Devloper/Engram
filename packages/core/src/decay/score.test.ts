import { describe, expect, it } from 'vitest';
import { config } from '../config/index.js';
import { crossingDays, decayedAccess, retentionScore } from './score.js';

const DAY = 86_400_000;
const t0 = new Date('2024-01-01T00:00:00Z');
const at = (days: number) => new Date(t0.getTime() + days * DAY);
const fact = (over: Partial<Parameters<typeof retentionScore>[0]> = {}) => ({
  importance: 0.5,
  accessScore: 0,
  lastAccessedAt: null,
  recordedAt: t0,
  tier: 'working' as const,
  ...over,
});
const { archiveThreshold } = config.decay;

describe('retentionScore', () => {
  it('starts at recency + importance for a fresh, never-accessed fact', () => {
    expect(retentionScore(fact(), t0)).toBeCloseTo(0.5 + 0.25 * 0.5, 10);
  });

  it('approaches 0.25 · importance as recency and access decay to nothing (§9.1 invariant)', () => {
    for (const importance of [0.2, 0.5, 0.8]) {
      expect(retentionScore(fact({ importance }), at(100_000))).toBeCloseTo(0.25 * importance, 6);
    }
  });

  it('archives a non-pinned fact by decay iff importance < 0.6', () => {
    const never = at(100_000);
    expect(retentionScore(fact({ importance: 0.55 }), never)).toBeLessThan(archiveThreshold);
    expect(retentionScore(fact({ importance: 0.6 }), never)).toBeGreaterThanOrEqual(
      archiveThreshold,
    );
    expect(retentionScore(fact({ importance: 0.65 }), never)).toBeGreaterThan(archiveThreshold);
  });

  it('crosses the threshold after ~3τ for default importance: ~42 days working, ~270 long-term', () => {
    expect(crossingDays(0.5, 'working')).toBeCloseTo(14 * Math.log(20), 6);
    expect(crossingDays(0.5, 'long_term')).toBeCloseTo(90 * Math.log(20), 6);
    expect(crossingDays(0.5, 'working')).toBeCloseTo(41.94, 1);
    expect(crossingDays(0.5, 'long_term')).toBeCloseTo(269.6, 1);
    expect(retentionScore(fact(), at(41.5))).toBeGreaterThan(archiveThreshold);
    expect(retentionScore(fact(), at(42.5))).toBeLessThan(archiveThreshold);
  });

  it('never crosses when importance alone keeps the score up', () => {
    expect(crossingDays(0.6, 'working')).toBe(Infinity);
    expect(crossingDays(0.9, 'long_term')).toBe(Infinity);
  });

  it('measures recency from the last access, falling back to record time', () => {
    const accessed = fact({ lastAccessedAt: at(40) });
    expect(retentionScore(accessed, at(41))).toBeGreaterThan(retentionScore(fact(), at(41)));
  });

  it('rewards accesses, saturating at ln(1 + 20)', () => {
    const many = retentionScore(fact({ accessScore: 20 }), at(1000));
    const more = retentionScore(fact({ accessScore: 500 }), at(1000));
    expect(many).toBeCloseTo(0.25 + 0.125, 6);
    expect(more).toBeCloseTo(many, 10);
  });

  it('decays access_score by exp(−Δt/τ) per tier', () => {
    expect(decayedAccess(10, 14, 'working')).toBeCloseTo(10 * Math.exp(-1), 10);
    expect(decayedAccess(10, 90, 'long_term')).toBeCloseTo(10 * Math.exp(-1), 10);
    expect(decayedAccess(10, 0, 'working')).toBe(10);
  });
});
