// Row mechanics for each resolution decision (SPEC §7.2). Runs inside the
// transaction that holds the namespace lock; every write uses the one
// transaction timestamp `t`. Every outcome except a plain insert into an
// empty history writes exactly one fact_revisions row.
import { randomUUID } from 'node:crypto';
import type { JSONValue } from 'postgres';
import type { TransactionSql } from '../db/client.js';
import { insertFactRevision } from '../db/factRevisions.js';
import { insertFact, invalidateFact } from '../db/facts.js';
import type { Resolution, ResolvedCandidate } from '../ingest/resolver.js';
import type { Fact, RevisionKind } from '../types/index.js';
import type { ResolvedDecision } from './rules.js';
import { reviseFact, statusForWindow } from './versioning.js';
import type { VersionChanges } from './versioning.js';

/** Noisy-OR, capped below certainty. */
export function combineConfidence(a: number, b: number): number {
  return Math.min(0.99, 1 - (1 - a) * (1 - b));
}

/** The audit payload stored with each revision: the model's candidate plus how it resolved. */
function payload(c: ResolvedCandidate): JSONValue {
  return JSON.parse(
    JSON.stringify({
      raw: c.raw,
      subjectId: c.subjectId,
      predicate: c.predicate,
      objectId: c.objectId,
      objectLiteral: c.objectLiteral,
      validFrom: c.validFromSource === 'unknown' ? 'unknown' : c.validFrom,
      validTo: c.validTo,
      confidence: c.confidence,
      sourceEpisodeIds: c.sourceEpisodeIds,
    }),
  ) as JSONValue;
}

function insertCandidate(
  tx: TransactionSql,
  c: ResolvedCandidate,
  t: Date,
  overrides: { id?: string; validTo?: Date | null; supersededBy?: string | null } = {},
): Promise<Fact> {
  const { raw: _raw, isCorrection: _isCorrection, objectName: _objectName, ...fact } = c;
  const validTo = overrides.validTo === undefined ? fact.validTo : overrides.validTo;
  return insertFact(tx, {
    ...fact,
    ...overrides,
    validTo,
    recordedAt: t,
    status: statusForWindow(validTo),
  });
}

/** What a merge changes on the existing row; empty when the candidate adds nothing. */
export function mergeChanges(e: Fact, c: ResolvedCandidate): VersionChanges {
  const changes: VersionChanges = {};
  const fresh = c.sourceEpisodeIds.filter((id) => !e.sourceEpisodeIds.includes(id));
  // Re-extracting the same episode (consolidation) must not count as new evidence.
  if (fresh.length > 0) {
    changes.sourceEpisodeIds = [...e.sourceEpisodeIds, ...fresh];
    changes.confidence = combineConfidence(e.confidence, c.confidence);
  }
  // An explicit bound beats one the row only had by default.
  if (c.validFromSource === 'explicit' && e.validFromSource !== 'explicit') {
    if (!e.validTo || c.validFrom < e.validTo) {
      changes.validFrom = c.validFrom;
      changes.validFromSource = 'explicit';
    }
  }
  const from = changes.validFrom ?? e.validFrom;
  if (c.validTo && c.validTo > from) {
    // An open row gets the stated end; a closed one only ever extends.
    if (e.validTo === null || c.validTo > e.validTo) changes.validTo = c.validTo;
  }
  return changes;
}

export async function applyDecision(
  tx: TransactionSql,
  d: ResolvedDecision,
  c: ResolvedCandidate,
  t: Date,
): Promise<Resolution> {
  const log = (kind: RevisionKind, oldFactId: string | null, newFactId: string | null) =>
    insertFactRevision(tx, {
      namespaceId: c.namespaceId,
      oldFactId,
      newFactId,
      kind,
      resolver: d.resolver,
      candidate: payload(c),
      reason: d.reason,
    });

  switch (d.kind) {
    case 'insert': {
      const f = await insertCandidate(tx, c, t);
      return { kind: 'inserted', factId: f.id };
    }
    case 'merge': {
      const changes = mergeChanges(d.target, c);
      const f =
        Object.keys(changes).length > 0 ? await reviseFact(tx, d.target, changes, t) : d.target;
      await log('merge', d.target.id, f.id);
      return { kind: 'merged', factId: f.id };
    }
    case 'coexist': {
      const f = await insertCandidate(tx, c, t);
      await log('coexist', null, f.id);
      return { kind: 'coexisted', factId: f.id };
    }
    case 'update': {
      // c first, so the closed copy can point at it.
      const f = await insertCandidate(tx, c, t, { id: randomUUID() });
      await reviseFact(tx, d.target, { validTo: c.validFrom, supersededBy: f.id }, t);
      await log('update', d.target.id, f.id);
      return { kind: 'updated', factId: f.id };
    }
    case 'backfill': {
      const f = await insertCandidate(tx, c, t, {
        validTo: d.validTo,
        supersededBy: d.successor.id,
      });
      await log('backfill', d.successor.id, f.id);
      return { kind: 'backfilled', factId: f.id };
    }
    case 'correction': {
      await invalidateFact(tx, d.target.id, { at: t, status: 'retracted' });
      const f = await insertCandidate(tx, c, t);
      await log('correction', d.target.id, f.id);
      return { kind: 'corrected', factId: f.id };
    }
    case 'reject': {
      await log('reject', d.target?.id ?? null, null);
      return { kind: 'rejected', factId: null };
    }
  }
}
