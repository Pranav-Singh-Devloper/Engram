// The benchmarks chapter (P09c chapter 13): the two headline runs and the
// judge-agreement sheet, from the committed reports (bench explorer:data).
import bench from '@/content/generated/benchmarks.json';

export interface ModeResult {
  accuracy: number;
  n: number;
  recallAt8: number | null;
  requestsPerItem?: number;
  promptTokensPerItem?: number;
}

export interface Run {
  runId: string;
  split: string;
  items: number;
  model: string;
  judge: string;
  modes: Record<string, ModeResult>;
  categories: Record<string, Record<string, { accuracy: number; n: number }>>;
}

export interface AgreementCounts {
  n: number;
  agreement: number;
  kappa: number | null;
  humanCorrect: number;
  humanIncorrect: number;
  judgeTooLenient: number;
  judgeTooStrict: number;
}

export const RUNS = bench.headline as Run[];
export const AGREEMENT = bench.agreement as {
  runs: string[];
  pooled: AgreementCounts;
  perRun: Record<string, AgreementCounts>;
};

/** The 2×2 table behind an agreement sheet: rows are the human label, columns the judge's. */
export function confusion(a: AgreementCounts) {
  return {
    bothCorrect: a.humanCorrect - a.judgeTooStrict,
    judgeTooStrict: a.judgeTooStrict,
    judgeTooLenient: a.judgeTooLenient,
    bothIncorrect: a.humanIncorrect - a.judgeTooLenient,
  };
}

/**
 * Cohen's κ for a 2×2 table: (p_o − p_e) / (1 − p_e). Undefined (null) when
 * chance agreement is already 1, as on a sheet where every label is one class.
 */
export function kappa(t: ReturnType<typeof confusion>): number | null {
  const n = t.bothCorrect + t.judgeTooStrict + t.judgeTooLenient + t.bothIncorrect;
  if (n === 0) return null;
  const po = (t.bothCorrect + t.bothIncorrect) / n;
  const humanYes = (t.bothCorrect + t.judgeTooStrict) / n;
  const judgeYes = (t.bothCorrect + t.judgeTooLenient) / n;
  const pe = humanYes * judgeYes + (1 - humanYes) * (1 - judgeYes);
  return pe >= 1 ? null : (po - pe) / (1 - pe);
}
