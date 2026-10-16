import type { JSONValue } from 'postgres';
import type { Queryable } from './client.js';
import { one } from './rows.js';
import type { FactRevision, Resolver, RevisionKind } from '../types/index.js';

export interface NewFactRevision {
  namespaceId: string;
  oldFactId?: string | null;
  newFactId?: string | null;
  kind: RevisionKind;
  resolver: Resolver;
  /** The extracted candidate, kept for rejects and audits. */
  candidate?: JSONValue;
  reason?: string | null;
  /** When the decision was made: the engine's transaction time. Defaults to now(). */
  createdAt?: Date;
}

export async function insertFactRevision(
  db: Queryable,
  revision: NewFactRevision,
): Promise<FactRevision> {
  return one(
    await db<FactRevision[]>`
      insert into fact_revisions
        (namespace_id, old_fact_id, new_fact_id, kind, resolver, candidate, reason, created_at)
      values (
        ${revision.namespaceId}, ${revision.oldFactId ?? null}, ${revision.newFactId ?? null},
        ${revision.kind}, ${revision.resolver},
        ${revision.candidate === undefined ? null : db.json(revision.candidate)},
        ${revision.reason ?? null}, coalesce(${revision.createdAt ?? null}::timestamptz, now())
      )
      returning *`,
  );
}

export async function listFactRevisions(
  db: Queryable,
  namespaceId: string,
): Promise<FactRevision[]> {
  return db<FactRevision[]>`
    select * from fact_revisions where namespace_id = ${namespaceId} order by created_at, id`;
}
