// Real recall traces (bench explorer:data): the story plus a few other topics,
// embedded with Gemini, recalled with `trace: true`. The rankers below mirror
// core's (retrieve/fuse.ts and recall.ts); recall.test.ts proves they give the
// engine's scores, so the chapter's k slider re-ranks exactly as recall would.
import raw from '@/content/generated/recall.json';

export const LIST_NAMES = ['facts', 'episodes', 'text', 'graph'] as const;
export type ListName = (typeof LIST_NAMES)[number];

export interface TraceCandidate {
  key: string;
  id: string;
  kind: 'fact' | 'episode';
  text: string;
  similarity: number;
  fused: number | null;
  recency: number;
  importance: number;
  self: number;
  score: number;
}

export interface Trace {
  query: string;
  abstained: boolean;
  bestSimilarity: number;
  returned: string[];
  ranker: 'rrf' | 'linear';
  rrfK: number;
  floor: number;
  weights: { recency: number; importance: number; self: number };
  lists: Record<ListName, string[]>;
  candidates: TraceCandidate[];
  /** The engine's linear-ranker score for each candidate, same query and store. */
  linearScores: Record<string, number>;
}

export interface FloorItem {
  id: string;
  category: string;
  best: number;
  correct: boolean;
}

export interface FloorRun {
  space: string;
  run: string;
  /** The floor the run used; simulation is valid only at or above it. */
  ran: number;
  items: FloorItem[];
  grid: ({ floor: number } & FloorOutcome)[];
}

export const RECALL = raw as {
  now: string;
  space: string;
  k: number;
  turns: number;
  traces: Trace[];
  floors: FloorRun[];
};

/** core config.recall.linearWeights (parity test). */
export const LINEAR_WEIGHTS = { similarity: 0.7, text: 0.2, recency: 0.05, importance: 0.05 };

/** Reciprocal rank fusion: each list contributes 1 / (k + rank), rank from 1 (core rrf). */
export function rrf(lists: readonly (readonly string[])[], k: number): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((key, i) => scores.set(key, (scores.get(key) ?? 0) + 1 / (k + i + 1)));
  }
  return scores;
}

/** score = base · (1 + w_r · recency + w_i · importance + w_s · self) (core withPriors). */
export const priorMultiplier = (c: TraceCandidate, w: Trace['weights']) =>
  1 + w.recency * c.recency + w.importance * c.importance + w.self * c.self;

export interface Ranked {
  c: TraceCandidate;
  score: number;
  /** Each list's 1 / (k + rank) share of the fused score (0 when the list missed it). */
  parts: Record<ListName, number>;
  multiplier: number;
}

const byScore = (a: Ranked, b: Ranked) =>
  b.score - a.score || b.c.similarity - a.c.similarity || a.c.text.localeCompare(b.c.text);

/** The RRF ranking at any k, with or without the priors. */
export function rankRrf(trace: Trace, k: number, priors = true): Ranked[] {
  return trace.candidates
    .map((c) => {
      const parts = Object.fromEntries(
        LIST_NAMES.map((n) => {
          const i = trace.lists[n].indexOf(c.key);
          return [n, i < 0 ? 0 : 1 / (k + i + 1)];
        }),
      ) as Record<ListName, number>;
      const base = LIST_NAMES.reduce((s, n) => s + parts[n], 0);
      const multiplier = priors ? priorMultiplier(c, trace.weights) : 1;
      return { c, score: base * multiplier, parts, multiplier };
    })
    .sort(byScore);
}

/** The min-max weighted-linear ranker (recall.ts's alternative, ADR-010). */
export function rankLinear(trace: Trace): Ranked[] {
  const sims = trace.candidates.map((c) => c.similarity);
  const lo = Math.min(...sims);
  const hi = Math.max(...sims);
  const text = trace.lists.text;
  const w = LINEAR_WEIGHTS;
  const none = { facts: 0, episodes: 0, text: 0, graph: 0 };
  return trace.candidates
    .map((c) => {
      const sim = hi === lo ? 1 : (c.similarity - lo) / (hi - lo);
      const i = text.indexOf(c.key);
      const textRank = i < 0 ? 0 : 1 - i / Math.max(1, text.length);
      const score =
        w.similarity * sim +
        w.text * textRank +
        w.recency * c.recency +
        w.importance * c.importance;
      return { c, score, parts: none, multiplier: 1 };
    })
    .sort(byScore);
}

export interface FloorOutcome {
  n: number;
  correct: number;
  abstentions: number;
  abstentionCorrect: number;
  wronglyAbstained: number;
}

/**
 * The bench's floor simulation (report.ts simulateFloor): under the floor an
 * item gets nothing back and the composer abstains, so it's correct exactly
 * when it's an abstention item.
 */
export function simulateFloor(items: readonly FloorItem[], floor: number): FloorOutcome {
  const outcome = items.map((r) => {
    const below = r.best < floor;
    return { r, below, correct: below ? r.category === 'abstention' : r.correct };
  });
  const abst = outcome.filter((o) => o.r.category === 'abstention');
  return {
    n: outcome.length,
    correct: outcome.filter((o) => o.correct).length,
    abstentions: abst.length,
    abstentionCorrect: abst.filter((o) => o.correct).length,
    wronglyAbstained: outcome.filter((o) => o.below && o.r.category !== 'abstention').length,
  };
}
