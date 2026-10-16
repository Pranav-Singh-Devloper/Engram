// Fact rows are immutable versions (SPEC §5.1). Changing a fact's content or
// validity window means inserting a new version that `revises` the old one,
// and invalidating the old one as `revised` at the same instant `t`. Because
// the new version's recorded_at and the old one's invalidated_at are equal,
// a knownAt query at any instant sees exactly one of them.
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/client.js';
import { insertFact, invalidateFact } from '../db/facts.js';
import type { Fact, ValidFromSource } from '../types/index.js';

/** What a new version may change. Everything else is copied. */
export interface VersionChanges {
  validFrom?: Date;
  validFromSource?: ValidFromSource;
  validTo?: Date | null;
  confidence?: number;
  sourceEpisodeIds?: string[];
  supersededBy?: string | null;
}

/** `superseded` when the valid window is closed, `active` when it's open. */
export function statusForWindow(validTo: Date | null): 'active' | 'superseded' {
  return validTo ? 'superseded' : 'active';
}

/**
 * Replaces `fact` with a new version carrying `changes`, recorded at `t`.
 * Run it inside the transaction that holds the namespace lock. Fails, rolling
 * back with the caller's transaction, if `fact` is no longer a current belief.
 */
export async function reviseFact(
  db: Queryable,
  fact: Fact,
  changes: VersionChanges,
  t: Date,
): Promise<Fact> {
  // Copy columns explicitly: callers may pass rows with extra fields (beliefs carry objectName).
  const { id } = fact;
  const content = {
    namespaceId: fact.namespaceId,
    subjectId: fact.subjectId,
    predicate: fact.predicate,
    predicateAdHoc: fact.predicateAdHoc,
    objectId: fact.objectId,
    objectLiteral: fact.objectLiteral,
    statement: fact.statement,
    embedding: fact.embedding,
    confidence: fact.confidence,
    importance: fact.importance,
    pinned: fact.pinned,
    accessScore: fact.accessScore,
    lastAccessedAt: fact.lastAccessedAt,
    validFrom: fact.validFrom,
    validFromSource: fact.validFromSource,
    validTo: fact.validTo,
    supersededBy: fact.supersededBy,
    tier: fact.tier,
    sourceEpisodeIds: fact.sourceEpisodeIds,
  };
  const validTo = changes.validTo === undefined ? fact.validTo : changes.validTo;
  // Invalidate first: it's the check that `fact` is still current.
  await invalidateFact(db, id, { at: t, status: 'revised' });
  return insertFact(db, {
    ...content,
    ...changes,
    id: randomUUID(),
    revises: id,
    recordedAt: t,
    status: statusForWindow(validTo),
  });
}
