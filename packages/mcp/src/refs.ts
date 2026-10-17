// Resolving an agent's entity reference inside one namespace: an id, a name
// or alias (case-insensitive), or the user themself. Never crosses namespaces.
import {
  findEntitiesByAlias,
  findEntitiesByName,
  getEntity,
  getSelfEntity,
  normalizeName,
} from '@engram/core';
import type { Entity, Queryable } from '@engram/core';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SELF_WORDS = new Set(['user', 'the user', 'me', 'self', 'myself', 'i']);

export type EntityRefResult = { entity: Entity } | { error: string };

export async function resolveEntityRef(
  db: Queryable,
  namespaceId: string,
  ref: string,
): Promise<EntityRefResult> {
  const text = ref.trim();
  if (UUID.test(text)) {
    const entity = await getEntity(db, text);
    return entity?.namespaceId === namespaceId
      ? { entity }
      : { error: `No entity with id ${text}.` };
  }
  const name = normalizeName(text);
  if (SELF_WORDS.has(name)) return { entity: await getSelfEntity(db, namespaceId) };

  const found = new Map<string, Entity>();
  for (const e of [
    ...(await findEntitiesByName(db, namespaceId, name, null)),
    ...(await findEntitiesByAlias(db, namespaceId, name, null)),
  ]) {
    found.set(e.id, e);
  }
  const matches = [...found.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      (a.description ?? '').localeCompare(b.description ?? '') ||
      a.id.localeCompare(b.id),
  );
  const [only] = matches;
  if (matches.length === 1 && only) return { entity: only };
  if (matches.length === 0) {
    return { error: `No entity named "${text}". Use engram_entities to search.` };
  }
  const list = matches
    .map(
      (e) =>
        `${e.name} (${e.type ?? 'unknown'}${e.description ? `: ${e.description}` : ''}) id ${e.id}`,
    )
    .join('; ');
  return { error: `"${text}" matches ${matches.length} entities; pass one id: ${list}.` };
}
