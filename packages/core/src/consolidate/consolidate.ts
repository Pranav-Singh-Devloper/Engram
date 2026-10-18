// The "sleep" phase (SPEC §8): summarize clusters of recent turns, send the
// summary's candidates back through the normal write path with their cited
// turns as provenance, promote what they create or confirm to long_term, and
// store the summary as a recallable episode.
import { systemClock } from '../config/clock.js';
import type { Clock } from '../config/clock.js';
import { config } from '../config/index.js';
import type { Queryable, Sql } from '../db/client.js';
import { insertEpisode } from '../db/episodes.js';
import { bindEmbeddingSpace } from '../db/namespaces.js';
import { similarityProfile } from '../config/profiles.js';
import { setFactTier } from '../db/facts.js';
import { toSql } from '../db/vector.js';
import { PREDICATE_NAMES } from '../conflict/predicates.js';
import { createConflictResolver } from '../conflict/resolver.js';
import { emptyOutcomes, resolveCandidates } from '../ingest/candidates.js';
import type { CandidateSource } from '../ingest/candidates.js';
import type { CandidateResolver, ResolutionKind } from '../ingest/resolver.js';
import type { Provider } from '../providers/provider.js';
import { pendingClusters } from './cluster.js';
import type { Cluster, ConsolidationConfig } from './cluster.js';
import { uuidArray } from '../db/client.js';

export interface ConsolidateOptions {
  namespaceId?: string;
  /** Caps model calls per run; defaults to `config.consolidation.maxClustersPerRun`. */
  maxClusters?: number;
  clock?: Clock;
  resolver?: CandidateResolver;
  cfg?: ConsolidationConfig;
}

export interface ConsolidateSummary {
  /** Clusters handled this run: summarized plus skipped. */
  clusters: number;
  summarized: number;
  /** Low-importance clusters marked consolidated without a model call. */
  skipped: number;
  /** Clusters left for a later run by the cap. */
  remaining: number;
  candidates: number;
  promoted: number;
  outcomes: Record<ResolutionKind, number>;
  /** Turns whose missing embeddings (e.g. after a purge redaction) were restored. */
  reembedded: number;
}

/** Restores embeddings a purge removed, so redacted turns are recallable by vector again. */
async function reembedTurns(
  db: Sql,
  provider: Provider,
  namespaceId: string | undefined,
): Promise<number> {
  const rows = await db<{ id: string; namespaceId: string; content: string }[]>`
    select id, namespace_id, content from episodes
    where embedding is null
      ${namespaceId ? db`and namespace_id = ${namespaceId}` : db``}
    order by id`;
  if (rows.length === 0) return 0;
  for (const ns of new Set(rows.map((r) => r.namespaceId))) {
    await bindEmbeddingSpace(db, ns, provider);
  }
  const vectors = await provider.embed(
    rows.map((r) => r.content),
    { purpose: 'document' },
  );
  for (const [i, r] of rows.entries()) {
    const v = vectors[i];
    if (v) await db`update episodes set embedding = ${toSql(v)} where id = ${r.id}`;
  }
  return rows.length;
}

async function markConsolidated(db: Queryable, cluster: Cluster): Promise<void> {
  await db`
    update episodes set consolidated = true
    where id = any(${uuidArray(
      db,
      cluster.turns.map((t) => t.id),
    )}::uuid[])`;
}

export async function consolidate(
  db: Sql,
  provider: Provider,
  options: ConsolidateOptions = {},
): Promise<ConsolidateSummary> {
  const clock = options.clock ?? systemClock;
  const resolver = options.resolver ?? createConflictResolver(provider);
  // Drift is a similarity threshold, so it follows the embedder's profile (ADR-017).
  const cfg: ConsolidationConfig = options.cfg ?? {
    ...config.consolidation,
    driftThreshold: (await similarityProfile(provider)).drift,
  };
  const result: ConsolidateSummary = {
    clusters: 0,
    summarized: 0,
    skipped: 0,
    remaining: 0,
    candidates: 0,
    promoted: 0,
    outcomes: emptyOutcomes(),
    reembedded: await reembedTurns(db, provider, options.namespaceId),
  };

  const clusters = await pendingClusters(db, { namespaceId: options.namespaceId }, cfg);
  for (const ns of new Set(clusters.map((c) => c.namespaceId))) {
    await bindEmbeddingSpace(db, ns, provider);
  }
  let calls = 0;
  for (const cluster of clusters) {
    // Small talk has nothing to consolidate; don't spend a call on it.
    if (cluster.maxImportance < cfg.minImportance) {
      await markConsolidated(db, cluster);
      result.clusters++;
      result.skipped++;
      continue;
    }
    if (calls >= (options.maxClusters ?? cfg.maxClustersPerRun)) {
      result.remaining++;
      continue;
    }
    calls++;

    const output = await provider.summarize({
      episodes: cluster.turns.map((t) => ({
        id: t.id,
        role: t.role,
        content: t.content,
        occurredAt: t.occurredAt,
      })),
      predicates: [...PREDICATE_NAMES],
    });
    const turns = new Map(cluster.turns.map((t) => [t.id, t]));
    const sources: CandidateSource[] = [];
    for (const { sourceEpisodeIds, ...raw } of output.candidates) {
      const cited = [...new Set(sourceEpisodeIds)].flatMap((id) => turns.get(id) ?? []);
      if (cited.length === 0) continue;
      cited.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
      sources.push({
        raw,
        sourceEpisodeIds: cited.map((t) => t.id),
        // Hints resolve against the latest cited turn (P06b risks).
        occurredAt: cited.at(-1)?.occurredAt ?? cluster.turns[0]?.occurredAt ?? clock.now(),
        context: cited.map((t) => `${t.role}: ${t.content}`).join('\n'),
        importance: Math.max(...cited.map((t) => t.importance)),
      });
    }
    const batch = await resolveCandidates(db, provider, cluster.namespaceId, sources, {
      clock,
      resolver,
    });
    // The only path to long_term (SPEC §8).
    const promote = new Set(batch.resolutions.flatMap((r) => (r.factId ? [r.factId] : [])));
    for (const id of promote) await setFactTier(db, id, 'long_term');

    const [embedding] = await provider.embed([output.summary], { purpose: 'document' });
    const last = cluster.turns.at(-1);
    await db.begin(async (tx) => {
      await insertEpisode(tx, {
        namespaceId: cluster.namespaceId,
        sessionId: cluster.sessionId,
        kind: 'summary',
        role: 'system',
        content: output.summary,
        embedding: embedding ?? null,
        importance: cluster.maxImportance,
        occurredAt: last?.occurredAt,
        createdAt: clock.now(),
        summarizes: cluster.turns.map((t) => t.id),
        // Summaries are never extracted (SPEC §8).
        processedAt: clock.now(),
        consolidated: true,
      });
      await markConsolidated(tx, cluster);
    });

    result.clusters++;
    result.summarized++;
    result.candidates += output.candidates.length;
    result.promoted += promote.size;
    for (const [kind, n] of Object.entries(batch.outcomes) as [ResolutionKind, number][]) {
      result.outcomes[kind] += n;
    }
  }
  return result;
}
