// The candidate pipeline shared by live extraction (process) and consolidation
// (SPEC §6.1 steps 2-4, §8): predicate normalization, validity windows,
// entity resolution, then conflict resolution with provenance.
import type { Clock } from '../config/clock.js';
import { lookupPredicate } from '../conflict/predicates.js';
import { UNKNOWN_START } from '../db/client.js';
import type { Sql } from '../db/client.js';
import { bindEmbeddingSpace, getSelfEntity } from '../db/namespaces.js';
import { similarityProfile } from '../config/profiles.js';
import { normalizePredicate } from '../extract/normalize.js';
import { resolveHint } from '../extract/temporal.js';
import type { EntityRef, FactCandidate } from '../providers/contracts.js';
import type { Provider } from '../providers/provider.js';
import { entityLabel, isSelfRef, resolveEntity } from '../resolve/entities.js';
import type { ValidFromSource } from '../types/index.js';
import type {
  CandidateResolver,
  Resolution,
  ResolutionKind,
  ResolvedCandidate,
} from './resolver.js';

/** A candidate as the model returned it, plus where it came from. */
export interface CandidateSource {
  raw: FactCandidate;
  /** The episodes that state it: its provenance. */
  sourceEpisodeIds: string[];
  /** The date its time hints resolve against. */
  occurredAt: Date;
  /** The text shown to disambiguation and adjudication. */
  context: string;
  importance: number;
  /**
   * Record time for this candidate, when it differs from the clock's: bulk
   * extraction replays history, so a fact is recorded when its turn was learned.
   */
  recordAt?: Date;
}

export interface CandidateBatch {
  createdEntities: number;
  /** Candidates dropped before resolution, e.g. an unusable predicate. */
  dropped: number;
  /** End bounds discarded because they weren't after the start. */
  droppedBounds: number;
  outcomes: Record<ResolutionKind, number>;
  resolutions: Resolution[];
}

export function emptyOutcomes(): Record<ResolutionKind, number> {
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

interface Window {
  validFrom: Date;
  validFromSource: ValidFromSource;
  validTo: Date | null;
  droppedBound: boolean;
}

/**
 * Turns a candidate's hints into a validity window. An end resolves to the
 * start of its period, so "from 2015 to 2018" meets "since 2018" instead of
 * overlapping it; "in summer 2023" (the same period at both ends) spans it.
 */
export function resolveWindow(raw: FactCandidate, occurredAt: Date): Window {
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

/** Every distinct non-self entity mention, keyed by label. */
function mentions(candidates: readonly FactCandidate[]): Map<string, EntityRef> {
  const refs = new Map<string, EntityRef>();
  for (const c of candidates) {
    for (const ref of [c.subject, c.object.kind === 'entity' ? c.object.entity : undefined]) {
      if (ref && !isSelfRef(ref)) refs.set(entityLabel(ref), ref);
    }
  }
  return refs;
}

export async function resolveCandidates(
  db: Sql,
  provider: Provider,
  namespaceId: string,
  sources: readonly CandidateSource[],
  options: { clock: Clock; resolver: CandidateResolver },
): Promise<CandidateBatch> {
  const result: CandidateBatch = {
    createdEntities: 0,
    dropped: 0,
    droppedBounds: 0,
    outcomes: emptyOutcomes(),
    resolutions: [],
  };
  if (sources.length === 0) return result;
  await bindEmbeddingSpace(db, namespaceId, provider);
  const profile = await similarityProfile(provider);

  // One embedding call for the batch: entity labels and statements together.
  const refs = mentions(sources.map((s) => s.raw));
  const labels = [...refs.keys()];
  const vectors = await provider.embed([...labels, ...sources.map((s) => s.raw.statement)], {
    purpose: 'document',
  });
  const labelVector = new Map(labels.map((label, i) => [label, vectors[i] ?? []]));
  const selfEntity = await getSelfEntity(db, namespaceId);

  for (const [i, source] of sources.entries()) {
    const { raw } = source;
    let predicate;
    try {
      predicate = normalizePredicate(raw.predicate);
    } catch {
      result.dropped++;
      continue;
    }
    const window = resolveWindow(raw, source.occurredAt);
    if (window.droppedBound) result.droppedBounds++;

    const resolveRef = async (ref: EntityRef) => {
      const r = await resolveEntity(db, provider, ref, labelVector.get(entityLabel(ref)) ?? [], {
        namespaceId,
        selfEntity,
        context: source.context,
        thresholds: profile,
      });
      if (r.created) result.createdEntities++;
      return r.entity;
    };
    let subject = await resolveRef(raw.subject);
    let object = raw.object.kind === 'entity' ? await resolveRef(raw.object.entity) : null;
    // One canonical direction for symmetric facts: the user first, else the lower id.
    if (object && lookupPredicate(predicate.predicate)?.symmetric) {
      const swap =
        object.id === selfEntity.id || (subject.id !== selfEntity.id && object.id < subject.id);
      if (swap) [subject, object] = [object, subject];
    }
    const candidate: ResolvedCandidate = {
      namespaceId,
      subjectId: subject.id,
      predicate: predicate.predicate,
      predicateAdHoc: predicate.adHoc,
      objectId: object?.id ?? null,
      objectLiteral: raw.object.kind === 'literal' ? raw.object.value : null,
      objectName: object?.name ?? (raw.object.kind === 'literal' ? raw.object.value : ''),
      statement: raw.statement,
      embedding: vectors[labels.length + i] ?? [],
      confidence: raw.confidence,
      importance: source.importance,
      validFrom: window.validFrom,
      validFromSource: window.validFromSource,
      validTo: window.validTo,
      isCorrection: raw.isCorrection,
      sourceEpisodeIds: source.sourceEpisodeIds,
      raw,
      context: source.context,
    };
    const at = source.recordAt;
    const clock = at ? { now: () => new Date(at) } : options.clock;
    const resolution = await options.resolver.resolve(db, candidate, { clock });
    result.outcomes[resolution.kind]++;
    result.resolutions.push(resolution);
  }
  return result;
}
