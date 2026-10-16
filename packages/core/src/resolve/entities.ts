// Entity resolution (SPEC §6.1 step 2). The ladder is exact name and type,
// then alias, then label-embedding similarity. Several matches, or a lone
// name match whose description conflicts, go to LLM disambiguation.
//
// No LLM call happens under the lock. The plan is computed and disambiguated
// outside any transaction, then re-checked under the namespace lock; if
// another writer changed the candidates in between, the flow starts over.
import { config } from '../config/index.js';
import { transaction } from '../db/client.js';
import type { Sql } from '../db/client.js';
import {
  addEntityAlias,
  fillEntityDescription,
  findEntitiesByAlias,
  findEntitiesByName,
  findSimilarEntities,
  insertEntity,
} from '../db/entities.js';
import type { Queryable } from '../db/client.js';
import { cosine } from '../db/vector.js';
import { cleanName, normalizeName } from '../extract/normalize.js';
import { SELF_REF } from '../providers/contracts.js';
import type { EntityRef } from '../providers/contracts.js';
import { ProviderOutputError } from '../providers/provider.js';
import type { Provider } from '../providers/provider.js';
import type { Entity } from '../types/index.js';
import { lockNamespace } from './lock.js';

export interface ResolveContext {
  namespaceId: string;
  selfEntity: Entity;
  /** The episode text, shown to the disambiguator. */
  context: string;
}

export type ResolvedVia = 'self' | 'exact' | 'alias' | 'embedding' | 'disambiguation' | 'new';

export interface EntityResolution {
  entity: Entity;
  created: boolean;
  via: ResolvedVia;
}

type Plan =
  | { kind: 'match'; entity: Entity; via: 'exact' | 'alias' | 'embedding' }
  | { kind: 'ambiguous'; candidates: Entity[] }
  | { kind: 'create' };

/** What gets embedded for an entity: `name (type): description`. */
export function entityLabel(ref: EntityRef): string {
  const label = `${cleanName(ref.name)} (${ref.type ?? 'unknown'})`;
  return ref.description ? `${label}: ${ref.description}` : label;
}

export function isSelfRef(ref: EntityRef): boolean {
  return ref.name.trim().toUpperCase() === SELF_REF;
}

function conflicts(mention: EntityRef, embedding: readonly number[], entity: Entity): boolean {
  if (!mention.description || !entity.description || !entity.embedding) return false;
  return cosine(embedding, entity.embedding) < config.entities.descriptionConflictThreshold;
}

async function plan(
  db: Queryable,
  namespaceId: string,
  mention: EntityRef,
  embedding: readonly number[],
): Promise<Plan> {
  const name = normalizeName(mention.name);
  for (const [via, find] of [
    ['exact', findEntitiesByName],
    ['alias', findEntitiesByAlias],
  ] as const) {
    const found = await find(db, namespaceId, name, mention.type);
    const [only] = found;
    if (found.length > 1) return { kind: 'ambiguous', candidates: found };
    if (only) {
      return conflicts(mention, embedding, only)
        ? { kind: 'ambiguous', candidates: [only] }
        : { kind: 'match', entity: only, via };
    }
  }
  const similar = await findSimilarEntities(
    db,
    namespaceId,
    embedding,
    config.entities.matchThreshold,
  );
  const [closest] = similar;
  if (similar.length > 1) return { kind: 'ambiguous', candidates: similar };
  if (closest) return { kind: 'match', entity: closest, via: 'embedding' };
  return { kind: 'create' };
}

/** Identifies a plan's outcome, so a re-check under the lock can tell whether anything moved. */
function fingerprint(p: Plan): string {
  switch (p.kind) {
    case 'match':
      return `match:${p.entity.id}`;
    case 'ambiguous':
      return `ambiguous:${p.candidates
        .map((c) => c.id)
        .sort()
        .join(',')}`;
    case 'create':
      return 'create';
  }
}

type Decision = { kind: 'use'; entity: Entity; via: ResolvedVia } | { kind: 'create' };

async function decide(
  provider: Pick<Provider, 'disambiguate'>,
  p: Plan,
  mention: EntityRef,
  ctx: ResolveContext,
): Promise<Decision> {
  if (p.kind === 'create') return { kind: 'create' };
  if (p.kind === 'match') return { kind: 'use', entity: p.entity, via: p.via };

  const out = await provider.disambiguate({
    mention,
    context: ctx.context,
    candidates: p.candidates.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      description: c.description,
      aliases: c.aliases,
    })),
  });
  if (out.entityId === null) return { kind: 'create' };
  const chosen = p.candidates.find((c) => c.id === out.entityId);
  if (!chosen) {
    throw new ProviderOutputError(
      'Disambiguation chose an id that was not a candidate',
      out.entityId,
    );
  }
  return { kind: 'use', entity: chosen, via: 'disambiguation' };
}

/**
 * Resolves a mention to a canonical entity, creating it if needed. `embedding`
 * is the mention's `entityLabel`, embedded by the caller (batched per episode).
 */
export async function resolveEntity(
  db: Sql,
  provider: Pick<Provider, 'disambiguate'>,
  mention: EntityRef,
  embedding: readonly number[],
  ctx: ResolveContext,
): Promise<EntityResolution> {
  if (isSelfRef(mention)) return { entity: ctx.selfEntity, created: false, via: 'self' };

  for (let attempt = 0; attempt < config.entities.maxResolveAttempts; attempt++) {
    const before = await plan(db, ctx.namespaceId, mention, embedding);
    const decision = await decide(provider, before, mention, ctx);

    const result = await transaction(db, async (tx) => {
      await lockNamespace(tx, ctx.namespaceId);
      const now = await plan(tx, ctx.namespaceId, mention, embedding);
      if (fingerprint(now) !== fingerprint(before)) return undefined;

      if (decision.kind === 'create') {
        const entity = await insertEntity(tx, {
          namespaceId: ctx.namespaceId,
          name: cleanName(mention.name),
          type: mention.type,
          description: mention.description,
          embedding,
        });
        return { entity, created: true, via: 'new' as const };
      }

      const { entity } = decision;
      const sameName = normalizeName(mention.name) === normalizeName(entity.name);
      if (!sameName) await addEntityAlias(tx, entity.id, cleanName(mention.name));
      if (sameName && !entity.description && mention.description) {
        await fillEntityDescription(tx, entity.id, mention.description, embedding);
      }
      return { entity, created: false, via: decision.via };
    });
    if (result) return result;
  }
  throw new Error(
    `Entity resolution for "${mention.name}" didn't settle after ${config.entities.maxResolveAttempts} attempts.`,
  );
}
