// The canonical bitemporal filter (SPEC §5.1). This is the only place it is
// written; every read of facts goes through it. "What did the system believe
// at record time K about the world at valid time T":
//
//   recorded_at <= K and (invalidated_at is null or invalidated_at > K)
//   and valid_from <= T and (valid_to is null or valid_to > T)
//
// It filters on time columns only, never on status.
import type { PendingQuery, Row } from 'postgres';
import { systemClock } from '../config/clock.js';
import type { Clock } from '../config/clock.js';
import type { Queryable } from '../db/client.js';
import { parseFact } from '../db/factRows.js';
import type { FactRow } from '../db/factRows.js';
import type { Fact } from '../types/index.js';

export interface AsOf {
  /** Valid time T: when in the world. */
  validAt: Date;
  /** Record time K: what the system believed then. */
  knownAt: Date;
  /** The archived tier is excluded unless this is set. */
  includeArchived?: boolean;
}

/** The filter as a fragment for a `where` clause, on facts aliased as `alias`. */
export function asOfPredicate(db: Queryable, asOf: AsOf, alias = 'f'): PendingQuery<Row[]> {
  const t = db(alias);
  return db`
    ${t}.recorded_at <= ${asOf.knownAt}
    and (${t}.invalidated_at is null or ${t}.invalidated_at > ${asOf.knownAt})
    and ${t}.valid_from <= ${asOf.validAt}
    and (${t}.valid_to is null or ${t}.valid_to > ${asOf.validAt})
    ${asOf.includeArchived ? db`` : db`and ${t}.tier <> 'archived'`}`;
}

/**
 * The episode analogue (SPEC §5.1): said by valid time T, and recorded by
 * record time K.
 */
export function episodesAsOfPredicate(db: Queryable, asOf: AsOf, alias = 'e'): PendingQuery<Row[]> {
  const t = db(alias);
  return db`${t}.occurred_at <= ${asOf.validAt} and ${t}.created_at <= ${asOf.knownAt}`;
}

export interface FactsAsOfQuery extends Partial<AsOf> {
  namespaceId: string;
  subjectId?: string;
  predicate?: string;
}

/** Facts believed at `knownAt` to hold at `validAt`; both default to now. */
export async function factsAsOf(
  db: Queryable,
  query: FactsAsOfQuery,
  clock: Clock = systemClock,
): Promise<Fact[]> {
  const now = clock.now();
  const asOf: AsOf = {
    validAt: query.validAt ?? now,
    knownAt: query.knownAt ?? now,
    includeArchived: query.includeArchived ?? false,
  };
  const rows = await db<FactRow[]>`
    select f.* from facts f
    where f.namespace_id = ${query.namespaceId}
      ${query.subjectId ? db`and f.subject_id = ${query.subjectId}` : db``}
      ${query.predicate ? db`and f.predicate = ${query.predicate}` : db``}
      and ${asOfPredicate(db, asOf)}
    order by f.valid_from, f.recorded_at, f.id`;
  return rows.map(parseFact);
}
