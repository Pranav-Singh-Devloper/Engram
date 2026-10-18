// Entity search for agents (SPEC §10 `engram_entities`): names and aliases that
// contain the query, then entities whose label embedding is close to it.
// Ordering is deterministic: match strength, then similarity, then name.
import type { Queryable } from '../db/client.js';
import { findSimilarEntities, parseEntity } from '../db/entities.js';
import { bindEmbeddingSpace } from '../db/namespaces.js';
import { similarityProfile } from '../config/profiles.js';
import type { EntityRow } from '../db/entities.js';
import { normalizeName } from '../extract/normalize.js';
import type { Provider } from '../providers/provider.js';
import type { Entity } from '../types/index.js';
import { uuidArray } from '../db/client.js';

export type EntityMatch = 'name' | 'alias' | 'similar';

export interface EntityHit {
  entity: Entity;
  match: EntityMatch;
  /** Cosine between the query and the entity label, when it was computed. */
  similarity: number | null;
  /** Current beliefs the entity takes part in, as subject or object. */
  facts: number;
}

export interface SearchEntitiesOptions {
  namespaceId: string;
  query: string;
  limit?: number;
}

const RANK: Record<EntityMatch, number> = { name: 0, alias: 1, similar: 2 };
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function searchEntities(
  db: Queryable,
  provider: Pick<Provider, 'embed' | 'embeddingSpace'>,
  options: SearchEntitiesOptions,
): Promise<EntityHit[]> {
  const limit = options.limit ?? 10;
  const needle = normalizeName(options.query);
  if (needle === '') return [];
  const like = `%${escapeLike(needle)}%`;
  const textRows = await db<(EntityRow & { byName: boolean })[]>`
    select *, lower(name) like ${like} as by_name from entities
    where namespace_id = ${options.namespaceId} and not is_self
      and (lower(name) like ${like} or exists (select 1 from unnest(aliases) a where lower(a) like ${like}))
    order by lower(name), id
    limit ${limit}`;
  await bindEmbeddingSpace(db, options.namespaceId, provider);
  const [query] = await provider.embed([options.query], { purpose: 'query' });
  const similar = query
    ? await findSimilarEntities(
        db,
        options.namespaceId,
        query,
        (await similarityProfile(provider)).entitySearch,
        limit,
      )
    : [];
  const similarity = new Map(similar.map((e) => [e.id, e.similarity]));

  const hits = new Map<string, Omit<EntityHit, 'facts'>>();
  for (const { byName, ...row } of textRows) {
    const entity = parseEntity(row);
    hits.set(entity.id, {
      entity,
      match: byName ? 'name' : 'alias',
      similarity: similarity.get(entity.id) ?? null,
    });
  }
  for (const { similarity: s, ...entity } of similar) {
    if (!hits.has(entity.id)) hits.set(entity.id, { entity, match: 'similar', similarity: s });
  }
  const ranked = [...hits.values()]
    .sort(
      (a, b) =>
        RANK[a.match] - RANK[b.match] ||
        (b.similarity ?? 0) - (a.similarity ?? 0) ||
        a.entity.name.localeCompare(b.entity.name) ||
        a.entity.id.localeCompare(b.entity.id),
    )
    .slice(0, limit);
  if (ranked.length === 0) return [];

  const ids = ranked.map((h) => h.entity.id);
  const counts = await db<{ id: string; n: number }[]>`
    select e.id, count(f.id)::int as n
    from unnest(${uuidArray(db, ids)}::uuid[]) as e(id)
    left join facts f on f.invalidated_at is null and (f.subject_id = e.id or f.object_id = e.id)
    group by e.id`;
  const facts = new Map(counts.map((c) => [c.id, c.n]));
  return ranked.map((h) => ({ ...h, facts: facts.get(h.entity.id) ?? 0 }));
}
