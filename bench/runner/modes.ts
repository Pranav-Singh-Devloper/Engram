// The four memory modes (SPEC §13.3). Each turns an item's history into the
// memories the shared composer answers from:
//   buffer        the last N turns
//   rag           vector search over turns only: no facts, conflicts or time
//   full_context  the whole history
//   engram        the full write path into a fresh namespace, then recall()
// Turns are prefixed with their dates in every mode.
import { randomUUID } from 'node:crypto';
import { SimClock, cosine, ensureNamespace, ingest, processEpisode, recall } from '@engram/core';
import type { Provider, RecallOptions, Sql } from '@engram/core';
import { turnTime } from '../dataset/schema.js';
import type { BenchItem } from '../dataset/schema.js';

export const MODES = ['buffer', 'rag', 'full_context', 'engram'] as const;
export type Mode = (typeof MODES)[number];

export const BUFFER_TURNS = 20;
export const RAG_K = 8;

export interface ModeAnswer {
  answer: string;
  supported: boolean;
  usedMemoryIds: string[];
  /** Memories handed to the composer. */
  memories: number;
  /** Texts of the retrieved memories (rag, engram), for recall@k. */
  retrieved?: string[];
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
  /** Overrides for engram's recall (tuning sweeps). */
  recall?: Partial<Pick<RecallOptions, 'ranker' | 'floor' | 'k'>>;
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
      const memories = turns
        .map((t, i) => ({ t, score: cosine(q ?? [], vectors[i] ?? []) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, RAG_K)
        .sort((a, b) => a.t.at.getTime() - b.t.at.getTime())
        .map((r) => episodeMemory(r.t));
      const answer = await compose(deps.provider, item, memories);
      return { ...answer, retrieved: memories.map((m) => m.text) };
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
      const episode = await ingest(
        db,
        provider,
        {
          namespaceId: namespace.id,
          sessionId: t.id.split('#')[0] ?? 's',
          role: 'user',
          content: t.text,
          occurredAt: t.at,
        },
        { clock },
      );
      await processEpisode(db, provider, episode.id, { clock });
    }

    clock.set(item.asked_at);
    const result = await recall(
      db,
      provider,
      {
        namespaceId: namespace.id,
        query: item.question,
        validAt: item.valid_at ? new Date(item.valid_at) : undefined,
        knownAt: item.known_at ? new Date(item.known_at) : undefined,
        trackAccess: false,
        ...deps.recall,
      },
      clock,
    );
    const memories = result.memories.map((m): Memory => ({
      id: m.id,
      kind: m.kind,
      text: m.text,
      validFrom: m.validFrom,
      validTo: m.validTo,
    }));
    const answer = await compose(provider, item, memories);
    return {
      ...answer,
      retrieved: memories.map((m) => m.text),
      store: await storeStats(db, namespace.id),
    };
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
