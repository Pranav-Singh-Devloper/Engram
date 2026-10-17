// Ranking for recall (SPEC §6.2 step 4). Pure functions over candidate lists.
import { UNKNOWN_START } from '../db/client.js';

const DAY = 86_400_000;

/** Reciprocal rank fusion: each list contributes 1 / (k + rank), rank from 1. */
export function rrf(lists: readonly (readonly string[])[], k: number): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((key, i) => scores.set(key, (scores.get(key) ?? 0) + 1 / (k + i + 1)));
  }
  return scores;
}

/** exp(−age / scale), with age measured to the valid time asked about. Unknown starts score 0. */
export function recency(at: Date | null, validAt: Date, scaleDays: number): number {
  if (at === null || at.getTime() === UNKNOWN_START.getTime()) return 0;
  const ageDays = Math.max(0, (validAt.getTime() - at.getTime()) / DAY);
  return Math.exp(-ageDays / scaleDays);
}

/**
 * The spec's mild prior: score = base · (1 + w_r · recency + w_i · importance
 * + w_s · self), where self is 1 for a fact about the user when the query is.
 */
export function withPriors(
  base: number,
  prior: { recency: number; importance: number; self?: number },
  weights: { recency: number; importance: number; self?: number },
): number {
  return (
    base *
    (1 +
      weights.recency * prior.recency +
      weights.importance * prior.importance +
      (weights.self ?? 0) * (prior.self ?? 0))
  );
}

/** Does the query ask about the user themself ("where do I live", "my sister")? */
export function aboutUser(query: string): boolean {
  return /\b(i|i'm|i've|i'd|me|my|mine|myself|the user)\b/i.test(query);
}

/** Min-max normalization to [0, 1]; a constant input maps to 1 (it's as good as it gets). */
export function minMax(values: readonly number[]): number[] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return values.map((v) => (hi === lo ? 1 : (v - lo) / (hi - lo)));
}
