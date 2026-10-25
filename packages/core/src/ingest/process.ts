// The slow half of the write path (SPEC §6.1 `process`): one LLM call for
// importance and candidate facts, then predicate normalization, date
// resolution, entity resolution and persistence with provenance.
import { config } from '../config/index.js';
import { ProviderBlockedError } from '../providers/provider.js';
import { systemClock } from '../config/clock.js';
import type { Clock } from '../config/clock.js';
import { PREDICATE_NAMES } from '../conflict/predicates.js';
import type { Sql } from '../db/client.js';
import { getEpisode, markEpisodeProcessed } from '../db/episodes.js';
import type { Provider } from '../providers/provider.js';
import type { Episode } from '../types/index.js';
import { createConflictResolver } from '../conflict/resolver.js';
import { emptyOutcomes, resolveCandidates } from './candidates.js';
import type { CandidateResolver, ResolutionKind } from './resolver.js';

export interface ProcessOptions {
  clock?: Clock;
  resolver?: CandidateResolver;
  extractFromToolOutput?: boolean;
}

export type ProcessStatus =
  'processed' | 'already_processed' | 'skipped_tool' | 'skipped_summary' | 'blocked';

export interface ProcessSummary {
  episodeId: string;
  status: ProcessStatus;
  importance: number | null;
  /** Candidates the model returned. */
  extracted: number;
  createdEntities: number;
  /** Candidates dropped before resolution, e.g. an unusable predicate. */
  dropped: number;
  /** End bounds discarded because they weren't after the start. */
  droppedBounds: number;
  outcomes: Record<ResolutionKind, number>;
}

function summary(episode: Episode, status: ProcessStatus): ProcessSummary {
  return {
    episodeId: episode.id,
    status,
    importance: null,
    extracted: 0,
    createdEntities: 0,
    dropped: 0,
    droppedBounds: 0,
    outcomes: emptyOutcomes(),
  };
}

/**
 * Extracts and stores facts from an episode. Idempotent: an episode that's
 * already processed is left alone. Tool output and consolidation summaries
 * are marked processed without extraction.
 */
export async function processEpisode(
  db: Sql,
  provider: Provider,
  episodeId: string,
  options: ProcessOptions = {},
): Promise<ProcessSummary> {
  const clock = options.clock ?? systemClock;
  const resolver = options.resolver ?? createConflictResolver(provider);
  const extractTools = options.extractFromToolOutput ?? config.extraction.extractFromToolOutput;

  const episode = await getEpisode(db, episodeId);
  if (!episode) throw new Error(`Episode ${episodeId} not found.`);
  if (episode.processedAt) return summary(episode, 'already_processed');
  if (episode.kind === 'summary' || (episode.role === 'tool' && !extractTools)) {
    await markEpisodeProcessed(db, episode.id, { at: clock.now() });
    return summary(episode, episode.kind === 'summary' ? 'skipped_summary' : 'skipped_tool');
  }

  let extraction;
  try {
    extraction = await provider.processEpisode({
      content: episode.content,
      role: episode.role,
      occurredAt: episode.occurredAt,
      predicates: [...PREDICATE_NAMES],
    });
  } catch (err) {
    if (!(err instanceof ProviderBlockedError)) throw err;
    // The model refuses this turn, and would every time: it adds no facts but
    // stays stored and recallable, and can't hold up the turns queued behind it.
    await markEpisodeProcessed(db, episode.id, { at: clock.now() });
    return summary(episode, 'blocked');
  }
  const batch = await resolveCandidates(
    db,
    provider,
    episode.namespaceId,
    extraction.candidates.map((raw) => ({
      raw,
      sourceEpisodeIds: [episode.id],
      occurredAt: episode.occurredAt,
      context: episode.content,
      importance: extraction.importance,
    })),
    { clock, resolver },
  );
  await markEpisodeProcessed(db, episode.id, {
    at: clock.now(),
    importance: extraction.importance,
  });
  const { resolutions: _resolutions, ...counts } = batch;
  return {
    ...summary(episode, 'processed'),
    ...counts,
    importance: extraction.importance,
    extracted: extraction.candidates.length,
  };
}
