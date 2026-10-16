// Fact rows are immutable versions (SPEC §5.1). This module deliberately has
// no general update: only invalidation, tier, pinning and access tracking
// change a row in place. Changing a fact's content or validity window means
// inserting a new version that `revises` the old one.
import type { Queryable } from './client.js';
import { defined, maybeOne, one } from './rows.js';
import { parseFact } from './factRows.js';
import type { FactRow } from './factRows.js';
import { toSql } from './vector.js';
import type { Fact, FactStatus, FactTier, ValidFromSource } from '../types/index.js';

export interface NewFact {
  id?: string;
  namespaceId: string;
  subjectId: string;
  predicate: string;
  predicateAdHoc?: boolean;
  objectId?: string | null;
  objectLiteral?: string | null;
  statement: string;
  embedding?: readonly number[] | null;
  confidence?: number;
  importance?: number;
  pinned?: boolean;
  validFrom: Date;
  validFromSource?: ValidFromSource;
  validTo?: Date | null;
  /** Required: record time comes from the engine's clock, never the database's `now()`. */
  recordedAt: Date;
  invalidatedAt?: Date | null;
  revises?: string | null;
  supersededBy?: string | null;
  status?: FactStatus;
  tier?: FactTier;
  sourceEpisodeIds?: string[];
}

export async function insertFact(db: Queryable, fact: NewFact): Promise<Fact> {
  const values = defined({
    ...fact,
    embedding: fact.embedding == null ? fact.embedding : toSql(fact.embedding),
  });
  return parseFact(one(await db<FactRow[]>`insert into facts ${db(values)} returning *`));
}

export async function getFact(db: Queryable, id: string): Promise<Fact | undefined> {
  const row = maybeOne(await db<FactRow[]>`select * from facts where id = ${id}`);
  return row && parseFact(row);
}

/**
 * Ends the system's belief in a row: `retracted` when it was wrong, `revised`
 * when a newer version replaces it. Fails if the row is already invalidated.
 */
export async function invalidateFact(
  db: Queryable,
  id: string,
  change: { at: Date; status: Extract<FactStatus, 'retracted' | 'revised'> },
): Promise<Fact> {
  const rows = await db<FactRow[]>`
    update facts set invalidated_at = ${change.at}, status = ${change.status}
    where id = ${id} and invalidated_at is null
    returning *`;
  if (rows.length === 0) throw new Error(`Fact ${id} is missing or already invalidated.`);
  return parseFact(one(rows));
}

export async function setFactTier(db: Queryable, id: string, tier: FactTier): Promise<void> {
  one(await db`update facts set tier = ${tier} where id = ${id} returning id`);
}

export async function setFactPinned(db: Queryable, id: string, pinned: boolean): Promise<void> {
  one(await db`update facts set pinned = ${pinned} where id = ${id} returning id`);
}

/** One batched write for every memory the caller actually used (SPEC §6.2 step 7). */
export async function recordFactAccess(
  db: Queryable,
  ids: readonly string[],
  at: Date,
): Promise<void> {
  if (ids.length === 0) return;
  await db`
    update facts set access_score = access_score + 1, last_accessed_at = ${at}
    where id = any(${db.array([...ids])}::uuid[])`;
}
