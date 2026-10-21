// recall() (SPEC §6.2): candidate lists under the canonical filters, graph
// expansion, fusion with mild priors, an abstention floor, and access
// tracking.
import { systemClock } from '../config/clock.js';
import type { Clock } from '../config/clock.js';
import { config } from '../config/index.js';
import { transaction } from '../db/client.js';
import type { Sql } from '../db/client.js';
import { cosine } from '../db/vector.js';
import type { Provider } from '../providers/provider.js';
import type { FactStatus, EpisodeRole } from '../types/index.js';
import { trackUse } from './access.js';
import { aboutUser, minMax, recency, rrf, withPriors } from './fuse.js';
import { similarityProfile } from '../config/profiles.js';
import { bindEmbeddingSpace, getSelfEntity } from '../db/namespaces.js';
import {
  graphNeighbours,
  prepareVectorSearch,
  textSearch,
  vectorEpisodes,
  vectorFacts,
} from './lists.js';
import type { Candidate } from './lists.js';

export type ListName = 'facts' | 'episodes' | 'text' | 'graph';

export interface RecallOptions {
  namespaceId: string;
  query: string;
  k?: number;
  validAt?: Date;
  knownAt?: Date;
  includeArchived?: boolean;
  /** Track access for every returned fact (MCP). Chat tracks the composer's ids instead. */
  trackAccess?: boolean;
  ranker?: 'rrf' | 'linear';
  floor?: number;
  /** Overrides config.recall.selfWeight (tuning on dev). */
  selfWeight?: number;
  /** Return how the ranking was made (RecallResult.trace). Off by default. */
  trace?: boolean;
}

export interface RecalledMemory {
  id: string;
  kind: 'fact' | 'episode';
  text: string;
  score: number;
  /** Raw cosine between the query and the memory. */
  similarity: number;
  /** Facts: the valid window. Episodes: when it was said, and null. */
  validFrom: Date;
  validTo: Date | null;
  /** The record window: when the system held it. */
  recordedAt: Date;
  invalidatedAt: Date | null;
  status: FactStatus | null;
  sourceEpisodeIds: string[];
  /** Episodes: who said it. Facts: null. */
  role: EpisodeRole | null;
  /** Facts: the subject and (entity) object, for linking to their timelines. Episodes: null. */
  subjectId: string | null;
  objectId: string | null;
  /** Which candidate lists found it. */
  lists: ListName[];
}

export interface RecallResult {
  memories: RecalledMemory[];
  /** The abstention floor fired: nothing was similar enough. */
  abstained: boolean;
  bestSimilarity: number;
  /** Present when asked for with `trace: true`. */
  trace?: RecallTrace;
}

/** One candidate as the ranker saw it. */
export interface TraceCandidate {
  key: string;
  id: string;
  kind: 'fact' | 'episode';
  text: string;
  similarity: number;
  /** The RRF sum before priors; null for the linear ranker or an abstention. */
  fused: number | null;
  recency: number;
  importance: number;
  self: number;
  /** The final score; 0 when recall abstained. */
  score: number;
}

/** How a recall was ranked: every list in rank order, and every candidate's scores. */
export interface RecallTrace {
  ranker: 'rrf' | 'linear';
  rrfK: number;
  floor: number;
  weights: { recency: number; importance: number; self: number };
  lists: Record<ListName, string[]>;
  candidates: TraceCandidate[];
}

/** A deterministic tie-break that doesn't depend on ids. */
function byContent(
  a: { text: string; validFrom: Date; kind: string },
  b: { text: string; validFrom: Date; kind: string },
): number {
  return (
    a.text.localeCompare(b.text) ||
    a.validFrom.getTime() - b.validFrom.getTime() ||
    a.kind.localeCompare(b.kind)
  );
}

export async function recall(
  db: Sql,
  provider: Pick<Provider, 'embed' | 'embeddingSpace'>,
  options: RecallOptions,
  clock: Clock = systemClock,
): Promise<RecallResult> {
  const cfg = config.recall;
  const now = clock.now();
  const asOf = {
    validAt: options.validAt ?? now,
    knownAt: options.knownAt ?? now,
    includeArchived: options.includeArchived ?? false,
  };
  await bindEmbeddingSpace(db, options.namespaceId, provider);
  const profile = await similarityProfile(provider);
  const [query] = await provider.embed([options.query], { purpose: 'query' });
  if (!query) throw new Error('Query embedding failed.');

  const lists = await transaction(db, async (tx) => {
    await prepareVectorSearch(tx);
    const ctx = { tx, namespaceId: options.namespaceId, asOf };
    const facts = await vectorFacts(ctx, query, cfg.factCandidates);
    const episodes = await vectorEpisodes(ctx, query, cfg.episodeCandidates);
    const text = await textSearch(ctx, options.query, cfg.ftsCandidates);
    const seeds = [
      ...facts.slice(0, cfg.graphSeeds),
      ...text.slice(0, cfg.graphSeeds),
      ...episodes.slice(0, cfg.graphSeeds),
    ];
    const graph = await graphNeighbours(ctx, seeds, cfg.graphLimit);
    // Vector lists are re-ranked by exact similarity (the HNSW iterative scan
    // returns near-ties in no fixed order) and graph neighbours by similarity
    // too. Ties break on content, never on ids, which differ between otherwise
    // identical stores: the same history must give the same recall.
    const bySimilarity = (list: Candidate[]) =>
      list.sort(
        (a, b) => cosine(query, b.embedding) - cosine(query, a.embedding) || byContent(a, b),
      );
    return {
      facts: bySimilarity(facts),
      episodes: bySimilarity(episodes),
      text,
      graph: bySimilarity(graph),
    } satisfies Record<ListName, Candidate[]>;
  });

  const byKey = new Map<string, Candidate>();
  const foundIn = new Map<string, ListName[]>();
  for (const [name, list] of Object.entries(lists) as [ListName, Candidate[]][]) {
    for (const c of list) {
      byKey.set(c.key, c);
      foundIn.set(c.key, [...(foundIn.get(c.key) ?? []), name]);
    }
  }
  const candidates = [...byKey.values()];
  const similarity = new Map(candidates.map((c) => [c.key, cosine(query, c.embedding)]));
  const bestSimilarity = Math.max(0, ...similarity.values());
  const floor = options.floor ?? profile.recallFloor;
  const ranker = options.ranker ?? cfg.ranker;
  const selfWeight = options.selfWeight ?? cfg.selfWeight;
  const traceOf = (
    fused: Map<string, number> | null,
    scores: Map<string, number>,
    prior: (c: Candidate) => { recency: number; importance: number; self: number },
  ): RecallTrace => ({
    ranker,
    rrfK: cfg.rrfK,
    floor,
    weights: { recency: cfg.recencyWeight, importance: cfg.importanceWeight, self: selfWeight },
    lists: Object.fromEntries(
      Object.entries(lists).map(([name, list]) => [name, list.map((c) => c.key)]),
    ) as Record<ListName, string[]>,
    candidates: candidates.map((c) => ({
      key: c.key,
      id: c.id,
      kind: c.kind,
      text: c.text,
      similarity: similarity.get(c.key) ?? 0,
      fused: fused ? (fused.get(c.key) ?? 0) : null,
      ...prior(c),
      score: scores.get(c.key) ?? 0,
    })),
  });
  if (candidates.length === 0 || bestSimilarity < floor) {
    return {
      memories: [],
      abstained: true,
      bestSimilarity,
      ...(options.trace && {
        trace: traceOf(null, new Map(), (c) => ({
          recency: recency(c.validFrom, asOf.validAt, cfg.recencyScaleDays),
          importance: c.importance,
          self: 0,
        })),
      }),
    };
  }

  const selfId =
    selfWeight > 0 && aboutUser(options.query)
      ? (await getSelfEntity(db, options.namespaceId)).id
      : null;
  const prior = (c: Candidate) => ({
    recency: recency(c.validFrom, asOf.validAt, cfg.recencyScaleDays),
    importance: c.importance,
    self: selfId !== null && c.subjectId === selfId ? 1 : 0,
  });
  const scores = new Map<string, number>();
  let fused: Map<string, number> | null = null;
  if (ranker === 'rrf') {
    fused = rrf(
      Object.values(lists).map((l) => l.map((c) => c.key)),
      cfg.rrfK,
    );
    for (const c of candidates) {
      scores.set(
        c.key,
        withPriors(fused.get(c.key) ?? 0, prior(c), {
          recency: cfg.recencyWeight,
          importance: cfg.importanceWeight,
          self: selfWeight,
        }),
      );
    }
  } else {
    const w = cfg.linearWeights;
    const sims = minMax(candidates.map((c) => similarity.get(c.key) ?? 0));
    const textRank = new Map(
      lists.text.map((c, i) => [c.key, 1 - i / Math.max(1, lists.text.length)]),
    );
    candidates.forEach((c, i) => {
      const p = prior(c);
      scores.set(
        c.key,
        w.similarity * (sims[i] ?? 0) +
          w.text * (textRank.get(c.key) ?? 0) +
          w.recency * p.recency +
          w.importance * p.importance,
      );
    });
  }

  const memories = candidates
    .map((c): RecalledMemory => ({
      id: c.id,
      kind: c.kind,
      text: c.text,
      score: scores.get(c.key) ?? 0,
      similarity: similarity.get(c.key) ?? 0,
      validFrom: c.validFrom,
      validTo: c.validTo,
      recordedAt: c.recordedAt,
      invalidatedAt: c.invalidatedAt,
      status: c.status,
      sourceEpisodeIds: c.sourceEpisodeIds,
      role: c.role,
      subjectId: c.subjectId,
      objectId: c.objectId,
      lists: foundIn.get(c.key) ?? [],
    }))
    .sort((a, b) => b.score - a.score || b.similarity - a.similarity || byContent(a, b))
    .slice(0, options.k ?? cfg.k);

  if (options.trackAccess ?? true) {
    await trackUse(
      db,
      memories.filter((m) => m.kind === 'fact').map((m) => m.id),
      clock,
    );
  }
  return {
    memories,
    abstained: false,
    bestSimilarity,
    ...(options.trace && { trace: traceOf(fused, scores, prior) }),
  };
}
