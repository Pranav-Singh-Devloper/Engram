// The four memory modes (SPEC §13.3). Each turns an item's history into the
// memories the shared composer answers from:
//   buffer        the last N turns
//   rag           vector search over turns only: no facts, conflicts or time
//   full_context  the whole history
//   engram        the full write path into a fresh namespace, then v0 recall
// Turns are prefixed with their dates in every mode.
import { randomUUID } from 'node:crypto';
import { SimClock, cosine, ensureNamespace, factsAsOf, ingest, processEpisode } from '@engram/core';
import type { Provider, Sql } from '@engram/core';
import { turnTime } from '../dataset/schema.js';
import type { BenchItem } from '../dataset/schema.js';

export const MODES = ['buffer', 'rag', 'full_context', 'engram'] as const;
export type Mode = (typeof MODES)[number];

export const BUFFER_TURNS = 20;
export const RAG_K = 8;
export const ENGRAM_FACTS = 8;
export const ENGRAM_EPISODES = 4;

export interface ModeAnswer {
  answer: string;
  supported: boolean;
  usedMemoryIds: string[];
  /** Memories handed to the composer. */
  memories: number;
  /** Engram only: what the write path produced. */
  store?: { facts: number; adHoc: number; entities: number; duplicateEntities: number };
}

interface Turn {
  id: string;
  text: string;
  at: Date;
}

function turnsOf(item: BenchItem): Turn[] {
  return item.setup_sessions.flatMap((s) =>
    s.turns.map((text, i) => ({ id: `${s.session_id}#${i}`, text, at: turnTime(s, i) })),
  );
}

type Memory = Parameters<Provider['compose']>[0]['memories'][number];

const episodeMemory = (t: Turn): Memory => ({
  id: t.id,
  kind: 'episode',
  text: t.text,
  validFrom: t.at,
  validTo: null,
});

async function compose(
  provider: Provider,
  item: BenchItem,
  memories: Memory[],
): Promise<ModeAnswer> {
  const out = await provider.compose({
    question: item.question,
    now: new Date(item.asked_at),
    memories,
  });
  return { ...out, memories: memories.length };
}

export interface ModeDeps {
  db: Sql;
  provider: Provider;
}

export async function runMode(mode: Mode, item: BenchItem, deps: ModeDeps): Promise<ModeAnswer> {
  const turns = turnsOf(item);
  switch (mode) {
    case 'buffer':
      return compose(deps.provider, item, turns.slice(-BUFFER_TURNS).map(episodeMemory));
    case 'full_context':
      return compose(deps.provider, item, turns.map(episodeMemory));
    case 'rag': {
      const vectors = await deps.provider.embed(
        turns.map((t) => t.text),
        { purpose: 'document' },
      );
      const [q] = await deps.provider.embed([item.question], { purpose: 'query' });
      const ranked = turns
        .map((t, i) => ({ t, score: cosine(q ?? [], vectors[i] ?? []) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, RAG_K)
        .sort((a, b) => a.t.at.getTime() - b.t.at.getTime());
      return compose(
        deps.provider,
        item,
        ranked.map((r) => episodeMemory(r.t)),
      );
    }
    case 'engram':
      return engram(item, turns, deps);
  }
}

async function engram(item: BenchItem, turns: Turn[], deps: ModeDeps): Promise<ModeAnswer> {
  const { db, provider } = deps;
  const { namespace } = await ensureNamespace(db, {
    slug: `bench-${item.id}-${randomUUID()}`,
    kind: 'bench',
  });
  try {
    const clock = new SimClock(turns[0]?.at ?? new Date(item.asked_at));
    for (const t of turns) {
      clock.set(t.at);
      const episode = await ingest(db, provider, {
        namespaceId: namespace.id,
        sessionId: t.id.split('#')[0] ?? 's',
        role: 'user',
        content: t.text,
        occurredAt: t.at,
      });
      await processEpisode(db, provider, episode.id, { clock });
    }

    // v0 recall (P05 replaces it): rank current beliefs and episodes by
    // similarity to the question, under the item's valid and record times.
    clock.set(item.asked_at);
    const validAt = new Date(item.valid_at ?? item.asked_at);
    const knownAt = new Date(item.known_at ?? item.asked_at);
    const [q] = await provider.embed([item.question], { purpose: 'query' });
    const facts = await factsAsOf(db, { namespaceId: namespace.id, validAt, knownAt }, clock);
    const topFacts = facts
      .map((f) => ({ f, score: f.embedding ? cosine(q ?? [], f.embedding) : -1 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, ENGRAM_FACTS)
      .map(({ f }): Memory => ({
        id: f.id,
        kind: 'fact',
        text: f.statement,
        validFrom: f.validFrom,
        validTo: f.validTo,
      }));
    // Episodes' record time is their occurred_at in a replay (created_at is wall-clock; see P05).
    const horizon = Math.min(validAt.getTime(), knownAt.getTime());
    const episodes = await db<
      { id: string; content: string; occurredAt: Date; embedding: string }[]
    >`
      select id, content, occurred_at, embedding::text as embedding from episodes
      where namespace_id = ${namespace.id} and occurred_at <= ${new Date(horizon)}`;
    const topEpisodes = episodes
      .map((e) => ({ e, score: cosine(q ?? [], JSON.parse(e.embedding) as number[]) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, ENGRAM_EPISODES)
      .map(({ e }): Memory => ({
        id: e.id,
        kind: 'episode',
        text: e.content,
        validFrom: e.occurredAt,
        validTo: null,
      }));

    const answer = await compose(provider, item, [...topFacts, ...topEpisodes]);
    return { ...answer, store: await storeStats(db, namespace.id) };
  } finally {
    await db`delete from namespaces where id = ${namespace.id}`;
  }
}

async function storeStats(db: Sql, namespaceId: string): Promise<NonNullable<ModeAnswer['store']>> {
  const [row] = await db<
    { facts: number; adHoc: number; entities: number; duplicateEntities: number }[]
  >`
    select
      (select count(*)::int from facts where namespace_id = ${namespaceId} and invalidated_at is null) as facts,
      (select count(*)::int from facts where namespace_id = ${namespaceId} and invalidated_at is null and predicate_ad_hoc) as ad_hoc,
      (select count(*)::int from entities where namespace_id = ${namespaceId} and not is_self) as entities,
      (select coalesce(sum(n - 1), 0)::int from (
         select count(*) as n from entities where namespace_id = ${namespaceId} and not is_self
         group by lower(name) having count(*) > 1) d) as duplicate_entities`;
  return row ?? { facts: 0, adHoc: 0, entities: 0, duplicateEntities: 0 };
}
