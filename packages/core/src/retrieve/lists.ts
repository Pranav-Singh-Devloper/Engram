// Recall's candidate lists (SPEC §6.2 steps 2-3). Every list applies the
// canonical as-of filters, so a candidate is something the system believed
// (at knownAt) about the world (at validAt). HNSW runs with pgvector's
// iterative scan, so a selective namespace filter can't starve a list.
import type { TransactionSql } from '../db/client.js';
import { fromSql, toSql } from '../db/vector.js';
import { asOfPredicate, episodesAsOfPredicate } from '../temporal/asOf.js';
import type { AsOf } from '../temporal/asOf.js';
import type { FactStatus, FactTier } from '../types/index.js';

export interface Candidate {
  /** `f:<id>` or `e:<id>`, unique across kinds. */
  key: string;
  kind: 'fact' | 'episode';
  id: string;
  text: string;
  embedding: number[];
  /** Facts: valid_from. Episodes: occurred_at. */
  validFrom: Date;
  validTo: Date | null;
  recordedAt: Date;
  invalidatedAt: Date | null;
  importance: number;
  status: FactStatus | null;
  tier: FactTier | null;
  sourceEpisodeIds: string[];
  subjectId: string | null;
  objectId: string | null;
}

interface Row {
  kind: 'fact' | 'episode';
  id: string;
  text: string;
  embedding: string;
  validFrom: Date;
  validTo: Date | null;
  recordedAt: Date;
  invalidatedAt: Date | null;
  importance: number;
  status: FactStatus | null;
  tier: FactTier | null;
  sourceEpisodeIds: string[];
  subjectId: string | null;
  objectId: string | null;
}

const toCandidate = (r: Row): Candidate => ({
  ...r,
  key: `${r.kind === 'fact' ? 'f' : 'e'}:${r.id}`,
  embedding: fromSql(r.embedding),
});

function factColumns(tx: TransactionSql) {
  return tx`
    'fact'::text as kind, f.id, f.statement as text, f.embedding::text as embedding,
    f.valid_from, f.valid_to, f.recorded_at, f.invalidated_at, f.importance,
    f.status, f.tier, f.source_episode_ids, f.subject_id, f.object_id`;
}

function episodeColumns(tx: TransactionSql) {
  return tx`
    'episode'::text as kind, e.id, e.content as text, e.embedding::text as embedding,
    e.occurred_at as valid_from, null::timestamptz as valid_to, e.created_at as recorded_at,
    null::timestamptz as invalidated_at, e.importance, null::text as status, null::text as tier,
    array[e.id] as source_episode_ids, null::uuid as subject_id, null::uuid as object_id`;
}

export interface ListContext {
  tx: TransactionSql;
  namespaceId: string;
  asOf: AsOf;
}

export async function prepareVectorSearch(tx: TransactionSql): Promise<void> {
  // pgvector 0.8: keep scanning the graph until enough rows pass the filters.
  await tx`set local hnsw.iterative_scan = relaxed_order`;
}

export async function vectorFacts(
  ctx: ListContext,
  query: readonly number[],
  limit: number,
): Promise<Candidate[]> {
  const { tx } = ctx;
  const q = toSql(query);
  const rows = await tx<Row[]>`
    select ${factColumns(tx)} from facts f
    where f.namespace_id = ${ctx.namespaceId} and f.embedding is not null
      and ${asOfPredicate(tx, ctx.asOf)}
    order by f.embedding <=> ${q} limit ${limit}`;
  return rows.map(toCandidate);
}

export async function vectorEpisodes(
  ctx: ListContext,
  query: readonly number[],
  limit: number,
): Promise<Candidate[]> {
  const { tx } = ctx;
  const q = toSql(query);
  const rows = await tx<Row[]>`
    select ${episodeColumns(tx)} from episodes e
    where e.namespace_id = ${ctx.namespaceId} and e.embedding is not null
      and ${episodesAsOfPredicate(tx, ctx.asOf)}
    order by e.embedding <=> ${q} limit ${limit}`;
  return rows.map(toCandidate);
}

/**
 * Full-text search over facts and episodes together, ranked by ts_rank. The
 * query's lexemes are OR-ed: an AND query of a natural question ("which city
 * does my sister live in") matches almost nothing.
 */
export async function textSearch(
  ctx: ListContext,
  query: string,
  limit: number,
): Promise<Candidate[]> {
  const { tx } = ctx;
  const rows = await tx<Row[]>`
    with q as (select replace(plainto_tsquery('english', ${query})::text, '&', '|')::tsquery as tsq)
    select * from (
      select ${factColumns(tx)}, ts_rank(to_tsvector('english', f.statement), q.tsq) as rank
      from facts f, q
      where f.namespace_id = ${ctx.namespaceId} and f.embedding is not null
        and ${asOfPredicate(tx, ctx.asOf)}
        and to_tsvector('english', f.statement) @@ q.tsq
      union all
      select ${episodeColumns(tx)}, ts_rank(to_tsvector('english', e.content), q.tsq) as rank
      from episodes e, q
      where e.namespace_id = ${ctx.namespaceId} and e.embedding is not null
        and ${episodesAsOfPredicate(tx, ctx.asOf)}
        and to_tsvector('english', e.content) @@ q.tsq
    ) hits
    order by rank desc, text, valid_from limit ${limit}`;
  return rows.map(toCandidate);
}

/**
 * 1-hop graph expansion (§6.2 step 3): facts about the entities that appear in
 * the seed candidates, directly or through the facts an episode produced. The
 * user's own entity is excluded: nearly every fact touches it.
 */
export async function graphNeighbours(
  ctx: ListContext,
  seeds: readonly Candidate[],
  limit: number,
): Promise<Candidate[]> {
  const { tx } = ctx;
  const direct = seeds
    .flatMap((c) => [c.subjectId, c.objectId])
    .filter((id): id is string => id !== null);
  const episodeIds = seeds.filter((c) => c.kind === 'episode').map((c) => c.id);
  if (direct.length === 0 && episodeIds.length === 0) return [];
  const rows = await tx<Row[]>`
    with seed as (
      select unnest(${tx.array(direct)}::uuid[]) as id
      union
      select unnest(array[f.subject_id, f.object_id]) from facts f
      where f.namespace_id = ${ctx.namespaceId}
        and f.source_episode_ids && ${tx.array(episodeIds)}::uuid[]
        and ${asOfPredicate(tx, ctx.asOf)}
    ),
    hub as (
      select s.id from seed s join entities n on n.id = s.id where s.id is not null and not n.is_self
    )
    select ${factColumns(tx)} from facts f
    where f.namespace_id = ${ctx.namespaceId} and f.embedding is not null
      and ${asOfPredicate(tx, ctx.asOf)}
      and (f.subject_id in (select id from hub) or f.object_id in (select id from hub))
    order by f.statement, f.valid_from
    limit ${limit}`;
  return rows.map(toCandidate);
}
