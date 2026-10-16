// The slow half of the write path (SPEC §6.1 `process`): one LLM call for
// importance and candidate facts, then predicate normalization, date
// resolution, entity resolution and persistence with provenance.
import { config } from '../config/index.js';
import { systemClock } from '../config/clock.js';
import type { Clock } from '../config/clock.js';
import { PREDICATE_NAMES } from '../conflict/predicates.js';
import { UNKNOWN_START } from '../db/client.js';
import type { Sql } from '../db/client.js';
import { getEpisode, markEpisodeProcessed } from '../db/episodes.js';
import { getSelfEntity } from '../db/namespaces.js';
import { normalizePredicate } from '../extract/normalize.js';
import { resolveHint } from '../extract/temporal.js';
import type { EntityRef, FactCandidate } from '../providers/contracts.js';
import type { Provider } from '../providers/provider.js';
import { entityLabel, isSelfRef, resolveEntity } from '../resolve/entities.js';
import type { ResolveContext } from '../resolve/entities.js';
import type { Episode, ValidFromSource } from '../types/index.js';
import { insertOnlyResolver } from './resolver.js';
import type { CandidateResolver, ResolutionKind, ResolvedCandidate } from './resolver.js';

export interface ProcessOptions {
  clock?: Clock;
  resolver?: CandidateResolver;
  extractFromToolOutput?: boolean;
}

export type ProcessStatus = 'processed' | 'already_processed' | 'skipped_tool' | 'skipped_summary';

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

function emptyOutcomes(): Record<ResolutionKind, number> {
  return {
    inserted: 0,
    merged: 0,
    updated: 0,
    backfilled: 0,
    corrected: 0,
    coexisted: 0,
    rejected: 0,
  };
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

/** Every distinct non-self entity mention in the candidates, keyed by label. */
function mentions(candidates: readonly FactCandidate[]): Map<string, EntityRef> {
  const refs = new Map<string, EntityRef>();
  for (const c of candidates) {
    for (const ref of [c.subject, c.object.kind === 'entity' ? c.object.entity : undefined]) {
      if (ref && !isSelfRef(ref)) refs.set(entityLabel(ref), ref);
    }
  }
  return refs;
}

interface Window {
  validFrom: Date;
  validFromSource: ValidFromSource;
  validTo: Date | null;
  droppedBound: boolean;
}

/**
 * Turns a candidate's hints into a validity window. An end resolves to the start of its period, so "from 2015 to 2018"
 * meets "since 2018" instead of overlapping it; "in summer 2023" (the same
 * period at both ends) spans that period.
 */
function resolveWindow(raw: FactCandidate, occurredAt: Date): Window {
  const from = resolveHint(raw.validFrom, occurredAt, 'start');
  const validFrom = from ?? occurredAt;
  const validFromSource = from ? 'explicit' : 'episode';
  let validTo = resolveHint(raw.validTo, occurredAt, 'start');
  if (!validTo || validTo > validFrom) {
    return { validFrom, validFromSource, validTo, droppedBound: false };
  }

  const samePeriod =
    raw.validTo.kind === 'named_period' &&
    JSON.stringify(raw.validTo) === JSON.stringify(raw.validFrom);
  if (samePeriod) {
    validTo = resolveHint(raw.validTo, occurredAt, 'end');
    return { validFrom, validFromSource: 'explicit', validTo, droppedBound: false };
  }
  // It ended before the turn and its start is unknown ("before that I lived in
  // Marseille"). Defaulting the start to the turn would invent a current fact.
  if (from === null) {
    return { validFrom: UNKNOWN_START, validFromSource: 'unknown', validTo, droppedBound: false };
  }
  // A point in time, or a bound that isn't after the start: keep the fact open.
  return { validFrom, validFromSource: 'explicit', validTo: null, droppedBound: true };
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
  const resolver = options.resolver ?? insertOnlyResolver;
  const extractTools = options.extractFromToolOutput ?? config.extraction.extractFromToolOutput;

  const episode = await getEpisode(db, episodeId);
  if (!episode) throw new Error(`Episode ${episodeId} not found.`);
  if (episode.processedAt) return summary(episode, 'already_processed');
  if (episode.kind === 'summary' || (episode.role === 'tool' && !extractTools)) {
    await markEpisodeProcessed(db, episode.id, { at: clock.now() });
    return summary(episode, episode.kind === 'summary' ? 'skipped_summary' : 'skipped_tool');
  }

  const extraction = await provider.processEpisode({
    content: episode.content,
    role: episode.role,
    occurredAt: episode.occurredAt,
    predicates: [...PREDICATE_NAMES],
  });
  const result: ProcessSummary = {
    ...summary(episode, 'processed'),
    importance: extraction.importance,
    extracted: extraction.candidates.length,
  };

  // One embedding call per episode: entity labels and statements together.
  const refs = mentions(extraction.candidates);
  const labels = [...refs.keys()];
  const statements = extraction.candidates.map((c) => c.statement);
  const vectors = await provider.embed([...labels, ...statements], { purpose: 'document' });
  const labelVector = new Map(labels.map((label, i) => [label, vectors[i] ?? []]));

  const selfEntity = await getSelfEntity(db, episode.namespaceId);
  const ctx: ResolveContext = {
    namespaceId: episode.namespaceId,
    selfEntity,
    context: episode.content,
  };
  const resolveRef = async (ref: EntityRef) => {
    const r = await resolveEntity(db, provider, ref, labelVector.get(entityLabel(ref)) ?? [], ctx);
    if (r.created) result.createdEntities++;
    return r.entity.id;
  };

  for (const [i, raw] of extraction.candidates.entries()) {
    let predicate;
    try {
      predicate = normalizePredicate(raw.predicate);
    } catch {
      result.dropped++;
      continue;
    }

    const { validFrom, validFromSource, validTo, droppedBound } = resolveWindow(
      raw,
      episode.occurredAt,
    );
    if (droppedBound) result.droppedBounds++;

    const candidate: ResolvedCandidate = {
      namespaceId: episode.namespaceId,
      subjectId: await resolveRef(raw.subject),
      predicate: predicate.predicate,
      predicateAdHoc: predicate.adHoc,
      objectId: raw.object.kind === 'entity' ? await resolveRef(raw.object.entity) : null,
      objectLiteral: raw.object.kind === 'literal' ? raw.object.value : null,
      statement: raw.statement,
      embedding: vectors[labels.length + i] ?? [],
      confidence: raw.confidence,
      importance: extraction.importance,
      validFrom,
      validFromSource,
      validTo,
      isCorrection: raw.isCorrection,
      sourceEpisodeIds: [episode.id],
      raw,
    };
    const resolution = await resolver.resolve(db, candidate, { recordedAt: clock.now() });
    result.outcomes[resolution.kind]++;
  }

  await markEpisodeProcessed(db, episode.id, {
    at: clock.now(),
    importance: extraction.importance,
  });
  return result;
}
