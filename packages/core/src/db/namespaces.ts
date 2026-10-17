import { transaction } from './client.js';
import type { Queryable, Sql, TransactionSql } from './client.js';
import { parseEntity } from './entities.js';
import type { EntityRow } from './entities.js';
import { maybeOne, one } from './rows.js';
import type { Entity, Namespace, NamespaceKind } from '../types/index.js';

export const SELF_ENTITY_NAME = 'User';

export interface EnsureNamespaceInput {
  slug: string;
  kind?: NamespaceKind;
  expiresAt?: Date;
}

export interface NamespaceWithSelf {
  namespace: Namespace;
  selfEntity: Entity;
}

/**
 * Returns the namespace for `slug`, creating it and its `is_self` entity if
 * needed. Idempotent and safe to call concurrently.
 */
export async function ensureNamespace(
  db: Sql | TransactionSql,
  input: EnsureNamespaceInput,
): Promise<NamespaceWithSelf> {
  const kind = input.kind ?? 'user';
  return transaction(db, async (tx) => {
    await tx`
      insert into namespaces (slug, kind, expires_at)
      values (${input.slug}, ${kind}, ${input.expiresAt ?? null})
      on conflict (slug) do nothing`;
    const namespace = one(
      await tx<Namespace[]>`select * from namespaces where slug = ${input.slug}`,
    );
    if (namespace.kind !== kind) {
      throw new Error(`Namespace ${input.slug} exists with kind ${namespace.kind}, not ${kind}.`);
    }
    await tx`
      insert into entities (namespace_id, name, type, is_self)
      values (${namespace.id}, ${SELF_ENTITY_NAME}, 'person', true)
      on conflict (namespace_id) where is_self do nothing`;
    return { namespace, selfEntity: await getSelfEntity(tx, namespace.id) };
  });
}

export async function getNamespace(db: Queryable, id: string): Promise<Namespace | undefined> {
  return maybeOne(await db<Namespace[]>`select * from namespaces where id = ${id}`);
}

export async function getNamespaceBySlug(
  db: Queryable,
  slug: string,
): Promise<Namespace | undefined> {
  return maybeOne(await db<Namespace[]>`select * from namespaces where slug = ${slug}`);
}

export async function getSelfEntity(db: Queryable, namespaceId: string): Promise<Entity> {
  return parseEntity(
    one(
      await db<EntityRow[]>`select * from entities where namespace_id = ${namespaceId} and is_self`,
    ),
  );
}

/** Deletes demo namespaces expired at `now`, with everything in them. Returns how many. */
export async function cleanupDemoNamespaces(db: Queryable, now: Date): Promise<number> {
  const row = one(
    await db<
      { deleted: number }[]
    >`select engram.engram_cleanup_demo(${now}::timestamptz) as deleted`,
  );
  return row.deleted;
}
