// Bulk extraction (P08, ADR-015): consecutive sessions packed into one model
// call each, instead of one call per turn. The bench and imports use it; live
// writes (MCP, chat) stay per turn. Candidates cite their turns, go through
// the same pipeline as live extraction, and resolve in time order. With
// recordTime 'cited' (history replays), each fact is recorded when its newest
// cited turn was learned, exactly as per-turn processing would have done.
import { systemClock } from '../config/clock.js';
import type { Clock } from '../config/clock.js';
import { config } from '../config/index.js';
import { uuidArray } from '../db/client.js';
import type { Sql } from '../db/client.js';
import { markEpisodeProcessed } from '../db/episodes.js';
import { PREDICATE_NAMES } from '../conflict/predicates.js';
import { createConflictResolver } from '../conflict/resolver.js';
import { ProviderOutputError } from '../providers/provider.js';
import type { Provider } from '../providers/provider.js';
import type { Episode } from '../types/index.js';
import { emptyOutcomes, resolveCandidates } from './candidates.js';
import type { CandidateSource } from './candidates.js';
import type { CandidateResolver, ResolutionKind } from './resolver.js';
import { processEpisode } from './process.js';

export interface SessionsOptions {
  clock?: Clock;
  resolver?: CandidateResolver;
  /** Token budget per call (estimated at 4 characters a token). */
  maxTokens?: number;
  /** Sessions per call; 1 keeps every call inside one session. */
  maxSessions?: number;
  /** 'now': record at the clock, as live writes do. 'cited': at the newest cited turn's record time. */
  recordTime?: 'now' | 'cited';
  extractFromToolOutput?: boolean;
}

export interface SessionsSummary {
  calls: number;
  /** Episodes extracted from (sent to the model). */
  episodes: number;
  /** Tool output and summaries, marked processed without extraction. */
  skipped: number;
  extracted: number;
  /** Candidates dropped: no user turn cited, an unusable predicate, … */
  dropped: number;
  createdEntities: number;
  outcomes: Record<ResolutionKind, number>;
  /** Packs whose reply failed validation, re-extracted one turn at a time. */
  fallbacks: number;
  /** Turns whose per-turn reply also failed: marked processed with no facts (ADR-016). */
  failed: number;
}

/** Rough tokens for packing: content plus the per-line label and date. */
const tokens = (e: Episode) => Math.ceil(e.content.length / 4) + 12;

/** Packs consecutive sessions into calls; a session over the budget is split by turns. */
export function packSessions(
  episodes: readonly Episode[],
  options: { maxTokens: number; maxSessions: number },
): Episode[][] {
  const sessions: Episode[][] = [];
  for (const e of episodes) {
    const last = sessions.at(-1);
    if (last && last[0]?.sessionId === e.sessionId) last.push(e);
    else sessions.push([e]);
  }
  const packs: Episode[][] = [];
  let pack: Episode[] = [];
  let packTokens = 0;
  let packSessions = 0;
  const flush = () => {
    if (pack.length > 0) packs.push(pack);
    pack = [];
    packTokens = 0;
    packSessions = 0;
  };
  for (const session of sessions) {
    const size = session.reduce((n, e) => n + tokens(e), 0);
    if (size > options.maxTokens) {
      flush();
      for (const e of session) {
        if (packTokens + tokens(e) > options.maxTokens) flush();
        pack.push(e);
        packTokens += tokens(e);
      }
      packSessions = 1;
      flush();
      continue;
    }
    if (packTokens + size > options.maxTokens || packSessions >= options.maxSessions) flush();
    pack.push(...session);
    packTokens += size;
    packSessions++;
  }
  flush();
  return packs;
}

export async function processSessions(
  db: Sql,
  provider: Provider,
  episodeIds: readonly string[],
  options: SessionsOptions = {},
): Promise<SessionsSummary> {
  const clock = options.clock ?? systemClock;
  const resolver = options.resolver ?? createConflictResolver(provider);
  const extractTools = options.extractFromToolOutput ?? config.extraction.extractFromToolOutput;
  const summary: SessionsSummary = {
    calls: 0,
    episodes: 0,
    skipped: 0,
    extracted: 0,
    dropped: 0,
    createdEntities: 0,
    outcomes: emptyOutcomes(),
    fallbacks: 0,
    failed: 0,
  };
  if (episodeIds.length === 0) return summary;

  const rows = await db<Episode[]>`
    select id, namespace_id, session_id, kind, role, content, importance, occurred_at,
           processed_at, consolidated, summarizes, created_at, null as embedding
    from episodes where id = any(${uuidArray(db, episodeIds)}::uuid[]) and processed_at is null
    order by occurred_at, created_at, id`;
  if (new Set(rows.map((r) => r.namespaceId)).size > 1) {
    throw new Error('processSessions: episodes span more than one namespace.');
  }
  const recordAt = (e: Episode) => (options.recordTime === 'cited' ? e.createdAt : clock.now());

  const extractable: Episode[] = [];
  for (const e of rows) {
    if (e.kind === 'summary' || (e.role === 'tool' && !extractTools)) {
      await markEpisodeProcessed(db, e.id, { at: recordAt(e) });
      summary.skipped++;
    } else {
      extractable.push(e);
    }
  }

  const packs = packSessions(extractable, {
    maxTokens: options.maxTokens ?? 20_000,
    maxSessions: options.maxSessions ?? Number.POSITIVE_INFINITY,
  });
  for (const pack of packs) {
    let out;
    try {
      out = await provider.extractSessions({
        turns: pack.map((e) => ({
          id: e.id,
          sessionId: e.sessionId,
          role: e.role,
          content: e.content,
          occurredAt: e.occurredAt,
        })),
        predicates: [...PREDICATE_NAMES],
      });
    } catch (err) {
      // A bad reply (local models, ~3%) costs one pack's batching, not the import.
      if (!(err instanceof ProviderOutputError)) throw err;
      summary.fallbacks++;
      await perTurn(pack);
      continue;
    }
    summary.calls++;
    summary.episodes += pack.length;
    summary.extracted += out.candidates.length;

    const byId = new Map(pack.map((e) => [e.id, e]));
    const importance = new Map(out.importance.map((i) => [i.episodeId, i.importance]));
    const sources: CandidateSource[] = [];
    for (const { sourceEpisodeIds, ...raw } of out.candidates) {
      const cited = [...new Set(sourceEpisodeIds)].flatMap((id) => byId.get(id) ?? []);
      // A fact only the assistant states is not a fact about the user (§6.1).
      if (!cited.some((e) => e.role === 'user')) {
        summary.dropped++;
        continue;
      }
      cited.sort(
        (a, b) =>
          a.occurredAt.getTime() - b.occurredAt.getTime() ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      );
      const newest = cited.at(-1) ?? cited[0];
      if (!newest) continue;
      sources.push({
        raw,
        sourceEpisodeIds: cited.map((e) => e.id),
        occurredAt: newest.occurredAt,
        context: cited.map((e) => `${e.role}: ${e.content}`).join('\n'),
        importance: Math.max(...cited.map((e) => importance.get(e.id) ?? e.importance)),
        recordAt: options.recordTime === 'cited' ? newest.createdAt : undefined,
      });
    }
    // Resolve in the order the facts were learned, as live writes would have.
    sources.sort(
      (a, b) =>
        (a.recordAt ?? a.occurredAt).getTime() - (b.recordAt ?? b.occurredAt).getTime() ||
        a.occurredAt.getTime() - b.occurredAt.getTime(),
    );
    const batch = await resolveCandidates(db, provider, pack[0]?.namespaceId ?? '', sources, {
      clock,
      resolver,
    });
    summary.dropped += batch.dropped;
    summary.createdEntities += batch.createdEntities;
    for (const [k, n] of Object.entries(batch.outcomes) as [ResolutionKind, number][]) {
      summary.outcomes[k] += n;
    }
    for (const e of pack) {
      await markEpisodeProcessed(db, e.id, { at: recordAt(e), importance: importance.get(e.id) });
    }
  }
  return summary;

  async function perTurn(pack: Episode[]): Promise<void> {
    for (const e of pack) {
      const at = recordAt(e);
      try {
        const r = await processEpisode(db, provider, e.id, {
          clock: options.recordTime === 'cited' ? { now: () => at } : clock,
          resolver,
          extractFromToolOutput: extractTools,
        });
        summary.calls++;
        summary.episodes++;
        summary.extracted += r.extracted;
        summary.dropped += r.dropped;
        summary.createdEntities += r.createdEntities;
        for (const [k, n] of Object.entries(r.outcomes) as [ResolutionKind, number][]) {
          summary.outcomes[k] += n;
        }
      } catch (err) {
        if (!(err instanceof ProviderOutputError)) throw err;
        summary.failed++;
        summary.episodes++;
        await markEpisodeProcessed(db, e.id, { at });
      }
    }
  }
}
