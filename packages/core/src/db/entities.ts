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
