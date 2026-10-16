import type { Queryable } from './client.js';
import { defined, maybeOne, one } from './rows.js';
import { fromSql, toSql } from './vector.js';
import type { Entity, EntityType } from '../types/index.js';

/** An entity as postgres.js returns it: the embedding is pgvector text. */
export type EntityRow = Omit<Entity, 'embedding'> & { embedding: string | null };

export function parseEntity(row: EntityRow): Entity {
  return { ...row, embedding: row.embedding === null ? null : fromSql(row.embedding) };
}

/** Self entities are created only by `ensureNamespace`. */
export interface NewEntity {
  id?: string;
  namespaceId: string;
  name: string;
  type?: EntityType | null;
  aliases?: string[];
  description?: string | null;
  embedding?: readonly number[] | null;
}

export async function insertEntity(db: Queryable, entity: NewEntity): Promise<Entity> {
  const values = defined({
    ...entity,
    embedding: entity.embedding == null ? entity.embedding : toSql(entity.embedding),
  });
  return parseEntity(one(await db<EntityRow[]>`insert into entities ${db(values)} returning *`));
}

export async function getEntity(db: Queryable, id: string): Promise<Entity | undefined> {
  const row = maybeOne(await db<EntityRow[]>`select * from entities where id = ${id}`);
  return row && parseEntity(row);
}

// Lookups for entity resolution (SPEC §6.1 step 2). Names are compared with
// lower(); callers pass names normalized by `normalizeName`. The self entity
// is reached only through the SELF reference, never by name.

/** Exact name match. A null type on either side matches any type. */
export async function findEntitiesByName(
  db: Queryable,
  namespaceId: string,
  normalizedName: string,
  type: EntityType | null,
): Promise<Entity[]> {
  const rows = await db<EntityRow[]>`
    select * from entities
    where namespace_id = ${namespaceId} and not is_self
      and lower(name) = ${normalizedName}
      and (${type}::text is null or type is null or type = ${type})
    order by created_at, id`;
  return rows.map(parseEntity);
}

export async function findEntitiesByAlias(
  db: Queryable,
  namespaceId: string,
  normalizedName: string,
  type: EntityType | null,
): Promise<Entity[]> {
  const rows = await db<EntityRow[]>`
    select * from entities
    where namespace_id = ${namespaceId} and not is_self
      and exists (select 1 from unnest(aliases) a where lower(a) = ${normalizedName})
      and (${type}::text is null or type is null or type = ${type})
    order by created_at, id`;
  return rows.map(parseEntity);
}

/** Nearest entities by label embedding, at or above `minSimilarity` (cosine). */
export async function findSimilarEntities(
  db: Queryable,
  namespaceId: string,
  embedding: readonly number[],
  minSimilarity: number,
  limit = 5,
): Promise<(Entity & { similarity: number })[]> {
  const v = toSql(embedding);
  const rows = await db<(EntityRow & { similarity: number })[]>`
    select *, 1 - (embedding <=> ${v}) as similarity from entities
    where namespace_id = ${namespaceId} and not is_self and embedding is not null
    order by embedding <=> ${v}
    limit ${limit}`;
  return rows
    .filter((r) => r.similarity >= minSimilarity)
    .map((r) => ({ ...parseEntity(r), similarity: r.similarity }));
}

/** Records a new surface form. No-op if it's already the name or an alias. */
export async function addEntityAlias(db: Queryable, id: string, alias: string): Promise<void> {
  await db`
    update entities set aliases = array_append(aliases, ${alias})
    where id = ${id} and lower(name) <> lower(${alias})
      and not exists (select 1 from unnest(aliases) a where lower(a) = lower(${alias}))`;
}

/** Fills in a description (and the label embedding that includes it) if there was none. */
export async function fillEntityDescription(
  db: Queryable,
  id: string,
  description: string,
  embedding: readonly number[],
): Promise<void> {
  await db`
    update entities set description = ${description}, embedding = ${toSql(embedding)}
    where id = ${id} and description is null`;
}
