// Entity resolution (SPEC §6.1 step 2). The ladder is exact name and type,
// then alias, then label-embedding similarity. Several matches, or a lone
// name match whose description conflicts, go to LLM disambiguation.
//
// No LLM call happens under the lock. The ladder runs under the namespace
// lock and a clear match or a create applies at once. An ambiguous plan
// releases the lock, asks the disambiguator, and applies its answer only if
// the candidates are unchanged when the lock is retaken.
import { config } from '../config/index.js';
import { transaction } from '../db/client.js';
import type { Sql, TransactionSql } from '../db/client.js';
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
import { namesCompatible } from './names.js';

export interface ResolveContext {
  namespaceId: string;
  selfEntity: Entity;
  /** The episode text, shown to the disambiguator. */
  context: string;
  /** The embedder's thresholds (ADR-017); Gemini's when omitted. */
  thresholds?: { entityMatch: number; descriptionConflict: number };
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

/**
 * A lone name match whose description conflicts goes to disambiguation. Only
 * for people: same-name people are common (two Sams), while a place or
 * organization's description just tracks the user's relationship to it
 * ("where I live", later "where I used to live"), and the dev bench showed
 * that drift splitting one city into two entities.
 */
function conflicts(
  mention: EntityRef,
  embedding: readonly number[],
  entity: Entity,
  threshold: number,
): boolean {
  if (mention.type !== 'person' && entity.type !== 'person') return false;
  if (!mention.description || !entity.description || !entity.embedding) return false;
  return cosine(embedding, entity.embedding) < threshold;
}

async function plan(
  db: Queryable,
  namespaceId: string,
  mention: EntityRef,
  embedding: readonly number[],
  thresholds: { entityMatch: number; descriptionConflict: number },
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
      return conflicts(mention, embedding, only, thresholds.descriptionConflict)
        ? { kind: 'ambiguous', candidates: [only] }
        : { kind: 'match', entity: only, via };
    }
  }
  // Similar labels only count when the names themselves could be variants.
  const similar = (
    await findSimilarEntities(db, namespaceId, embedding, thresholds.entityMatch)
  ).filter(
    (e) =>
      namesCompatible(mention.name, e.name) ||
      e.aliases.some((a) => namesCompatible(mention.name, a)),
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
  p: Extract<Plan, { kind: 'ambiguous' }>,
  mention: EntityRef,
  ctx: ResolveContext,
): Promise<Decision> {
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
  const thresholds = ctx.thresholds ?? {
    entityMatch: config.entities.matchThreshold,
    descriptionConflict: config.entities.descriptionConflictThreshold,
  };

  const apply = async (tx: TransactionSql, decision: Decision): Promise<EntityResolution> => {
    if (decision.kind === 'create') {
      const entity = await insertEntity(tx, {
        namespaceId: ctx.namespaceId,
        name: cleanName(mention.name),
        type: mention.type,
        description: mention.description,
        embedding,
      });
      return { entity, created: true, via: 'new' };
    }
    const { entity } = decision;
    const sameName = normalizeName(mention.name) === normalizeName(entity.name);
    if (!sameName) await addEntityAlias(tx, entity.id, cleanName(mention.name));
    if (sameName && !entity.description && mention.description) {
      await fillEntityDescription(tx, entity.id, mention.description, embedding);
    }
    return { entity, created: false, via: decision.via };
  };

  // A disambiguation is only valid for the candidates it was asked about.
  let disambiguated: { fingerprint: string; decision: Decision } | undefined;

  for (let attempt = 0; attempt < config.entities.maxResolveAttempts; attempt++) {
    const result = await transaction(db, async (tx) => {
      await lockNamespace(tx, ctx.namespaceId);
      const now = await plan(tx, ctx.namespaceId, mention, embedding, thresholds);
      let decision: Decision;
      if (now.kind !== 'ambiguous') {
        // No LLM needed: apply under the lock straight away.
        decision =
          now.kind === 'create'
            ? { kind: 'create' }
            : { kind: 'use', entity: now.entity, via: now.via };
      } else if (disambiguated?.fingerprint === fingerprint(now)) {
        decision = disambiguated.decision;
      } else {
        return { ambiguous: now };
      }
      return apply(tx, decision);
    });
    if (!('ambiguous' in result)) return result;

    // The LLM is asked outside any transaction, then the loop re-checks.
    disambiguated = {
      fingerprint: fingerprint(result.ambiguous),
      decision: await decide(provider, result.ambiguous, mention, ctx),
    };
  }
  throw new Error(
    `Entity resolution for "${mention.name}" didn't settle after ${config.entities.maxResolveAttempts} attempts.`,
  );
}
