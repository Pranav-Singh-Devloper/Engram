// The benchmarks chapter recomputes κ from the agreement counts and gets the
// bench's own value, including "undefined" for a one-class sheet.
import { describe, expect, it } from 'vitest';
import { AGREEMENT, RUNS, confusion, kappa } from './benchmarks';

describe('benchmarks chapter data', () => {
  it('has the two headline runs', () => {
    expect(RUNS.map((r) => r.split)).toEqual(['test', 'longmemeval']);
    expect(RUNS[1]?.items).toBe(98);
  });

  it('recomputes the bench’s κ from the counts, pooled and per run', () => {
    for (const a of [AGREEMENT.pooled, ...Object.values(AGREEMENT.perRun)]) {
      const k = kappa(confusion(a));
      if (a.kappa === null) expect(k).toBeNull();
      else expect(k).toBeCloseTo(a.kappa, 10);
    }
  });

  it('computes κ for tables that disagree', () => {
    // 20 both-yes, 5 judge-only-no, 10 judge-only-yes, 15 both-no: p_o 0.7, p_e 0.5.
    expect(
      kappa({ bothCorrect: 20, judgeTooStrict: 5, judgeTooLenient: 10, bothIncorrect: 15 }),
    ).toBeCloseTo(0.4, 10);
  });
});
