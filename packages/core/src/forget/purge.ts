// The hard purge (SPEC §9.3): irreversible, behind an explicit flag, and it
// removes the information from every place it lives. One transaction, in an
// order that respects the self-referencing fact links and revision FKs.
import type { TransactionSql } from '../db/client.js';

export const REDACTED = '[redacted]';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface PurgeReport {
  facts: number;
  revisions: number;
  episodesDeleted: number;
  episodesRedacted: number;
  summariesDeleted: number;
  entitiesDeleted: number;
}

/** Purges `targets` and their whole version chain. Runs inside the caller's locked transaction. */
export async function purgeFacts(
  tx: TransactionSql,
  namespaceId: string,
  targets: readonly string[],
): Promise<PurgeReport> {
  // 1. The purge set: targets plus every version linked through `revises`, both ways.
  const set = (
    await tx<{ id: string }[]>`
      with recursive chain(id) as (
        select id from facts where namespace_id = ${namespaceId} and id = any(${tx.array([...targets])}::uuid[])
        union
        select f.id from facts f, chain c
        where f.namespace_id = ${namespaceId}
          and (f.revises = c.id or f.id = (select x.revises from facts x where x.id = c.id))
      )
      select id from chain`
  ).map((r) => r.id);
  const ids = tx.array(set);

  const sources = (
    await tx<{ id: string }[]>`
      select distinct unnest(source_episode_ids) as id from facts where id = any(${ids}::uuid[])`
  ).map((r) => r.id);
  const entities = (
    await tx<{ id: string }[]>`
      select distinct unnest(array[subject_id, object_id]) as id from facts where id = any(${ids}::uuid[])`
  )
    .map((r) => r.id)
    .filter(Boolean);
  const literals = (
    await tx<{ value: string }[]>`
      select distinct object_literal as value from facts
      where id = any(${ids}::uuid[]) and object_literal is not null`
  ).map((r) => r.value);

  // 2. Rows outside the set that point into it (successors, backfilled history) lose the pointer.
  await tx`update facts set revises = null where revises = any(${ids}::uuid[]) and not id = any(${ids}::uuid[])`;
  await tx`
    update facts set superseded_by = null
    where superseded_by = any(${ids}::uuid[]) and not id = any(${ids}::uuid[])`;

  // 3. Revision rows touching the set, and any whose candidate came from a purged turn.
  const revisions = await tx`
    delete from fact_revisions
    where namespace_id = ${namespaceId}
      and (old_fact_id = any(${ids}::uuid[]) or new_fact_id = any(${ids}::uuid[])
           or (candidate -> 'sourceEpisodeIds') ?| ${tx.array(sources)}::text[])`;

  // 4. The facts themselves (their embeddings go with them).
  const facts = await tx`delete from facts where id = any(${ids}::uuid[])`;
  const survivingLiterals = new Set(
    (
      await tx<{ value: string }[]>`
        select distinct object_literal as value from facts
        where namespace_id = ${namespaceId} and object_literal = any(${tx.array(literals)}::text[])`
    ).map((r) => r.value),
  );

  // Labels of the purged value: literals no remaining fact uses, and the names
  // and aliases of entities the purge leaves without any fact.
  const orphanRows = await tx<{ id: string; name: string; aliases: string[] }[]>`
    select e.id, e.name, e.aliases from entities e
    where e.id = any(${tx.array(entities)}::uuid[]) and not e.is_self
      and not exists (select 1 from facts f where f.subject_id = e.id or f.object_id = e.id)`;
  const terms = [
    ...new Set(
      [
        ...orphanRows.flatMap((e) => [e.name, ...e.aliases]),
        ...literals.filter((l) => !survivingLiterals.has(l)),
      ]
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
    ),
  ];

  // 5. Episodes. A source episode backing nothing else is deleted. Any other
  // episode mentioning a term has just the term redacted (a source episode
  // where the value was only implied is redacted whole). Embeddings of
  // changed episodes are dropped: they encoded the old text.
  const deleted = await tx`
    delete from episodes
    where id = any(${tx.array(sources)}::uuid[])
      and not exists (select 1 from facts f where f.source_episode_ids @> array[episodes.id])`;
  const pattern =
    terms.length > 0 ? new RegExp(`\\b(${terms.map(escapeRegExp).join('|')})\\b`, 'gi') : null;
  const touched = await tx<{ id: string; content: string }[]>`
    select id, content from episodes
    where namespace_id = ${namespaceId}
      and (id = any(${tx.array(sources)}::uuid[])
        ${terms.length > 0 ? tx`or content ~* ${terms.map((t) => `\\m${escapeRegExp(t)}\\M`).join('|')}` : tx``})`;
  let redacted = 0;
  for (const e of touched) {
    const spans = pattern ? e.content.replace(pattern, REDACTED) : e.content;
    const content = spans !== e.content ? spans : sources.includes(e.id) ? REDACTED : e.content;
    if (content === e.content) continue;
    await tx`update episodes set content = ${content}, embedding = null where id = ${e.id}`;
    redacted++;
  }
  const changed = [...sources, ...touched.map((e) => e.id)];

  // 6. Summaries built from those episodes (regenerated by consolidation, P06b).
  const summaries = await tx`
    delete from episodes
    where namespace_id = ${namespaceId} and kind = 'summary'
      and summarizes && ${tx.array(changed)}::uuid[]`;

  // 7. Entities the purge left without any fact: their names would otherwise survive.
  const orphans =
    await tx`delete from entities where id = any(${tx.array(orphanRows.map((e) => e.id))}::uuid[])`;

  return {
    facts: facts.count,
    revisions: revisions.count,
    episodesDeleted: deleted.count,
    episodesRedacted: redacted,
    summariesDeleted: summaries.count,
    entitiesDeleted: orphans.count,
  };
}
