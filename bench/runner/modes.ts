// The four memory modes (SPEC §13.3). Each turns an item's history into the
// memories the shared composer answers from:
//   buffer        the last N turns
//   rag           vector search over turns only: no facts, conflicts or time
//   full_context  the whole history
//   engram        the full write path into a fresh namespace, then recall()
//   engram_consolidated  engram, plus a consolidation run after each session
//                 (opt-in: named explicitly, never part of "all")
// Turns are prefixed with their dates in every mode.
import { randomUUID } from 'node:crypto';
import {
  SimClock,
  config,
  consolidate,
  cosine,
  ensureNamespace,
  ingest,
  ingestMany,
  processEpisode,
  processSessions,
  recall,
} from '@engram/core';
import type { Provider, RecallOptions, Sql } from '@engram/core';
import { turnTime } from '../dataset/schema.js';
import type { BenchItem } from '../dataset/schema.js';

/** What `--memory=all` runs. */
export const MODES = ['buffer', 'rag', 'full_context', 'engram'] as const;
/** Opt-in modes, run only when named. */
export const EXTRA_MODES = ['engram_consolidated'] as const;
export type Mode = (typeof MODES)[number] | (typeof EXTRA_MODES)[number];
export const ALL_MODES: readonly Mode[] = [...MODES, ...EXTRA_MODES];

/**
 * How engram extracts (P08, ADR-015): one call per turn (the live path), one
 * per session, or sessions packed into calls of PACK_TOKENS. Packing blurs
 * record time within a pack, so it's only for splits without known_at items.
 */
export const EXTRACTIONS = ['turn', 'session', 'packed'] as const;
export type Extraction = (typeof EXTRACTIONS)[number];
export const PACK_TOKENS = 20_000;

/** Consolidation runs this long after a session's last turn ("that night"). */
export const CONSOLIDATE_AFTER_MS = 60 * 60 * 1000;

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
  /** Engram: best raw query similarity, and the floor the run used (for floor simulation). */
  bestSimilarity?: number;
  floor?: number;
  /** Engram retrieval-only runs: what each ranker retrieved; nothing was composed. */
  retrievedBy?: Record<'rrf' | 'linear', string[]>;
  /** Engram only: what the write path produced. */
  store?: {
    facts: number;
    adHoc: number;
    entities: number;
    duplicateEntities: number;
    /** fact_revisions rows, and how many the LLM adjudicator decided (ledger row 12). */
    revisions?: number;
    llmRevisions?: number;
  };
  /** engram_consolidated only: what consolidation did. */
  consolidation?: {
    summarized: number;
    skipped: number;
    promoted: number;
    longTermFacts: number;
    outcomes: Record<string, number>;
    /** Statements of facts consolidation newly inserted, for a read-through (ledger row 28). */
    inserted?: string[];
  };
}

interface Turn {
  id: string;
  text: string;
  at: Date;
  role: 'user' | 'assistant';
}

function turnsOf(item: BenchItem): Turn[] {
  return item.setup_sessions.flatMap((s) =>
    s.turns.map((text, i) => ({
      id: `${s.session_id}#${i}`,
      text,
      at: turnTime(s, i),
      role: s.roles?.[i] ?? 'user',
    })),
  );
}

type Memory = Parameters<Provider['compose']>[0]['memories'][number];

/**
 * What the composer sees for a turn. Our splits are all user turns, so their
 * text is unchanged (recordings stay valid); an assistant turn (LongMemEval)
 * is labelled, so "what did you recommend?" can be answered.
 */
const spoken = (role: string | null, text: string) =>
  role === 'assistant' ? `assistant: ${text}` : text;

const episodeMemory = (t: Turn): Memory => ({
  id: t.id,
  kind: 'episode',
  text: spoken(t.role, t.text),
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
  recall?: Partial<Pick<RecallOptions, 'ranker' | 'floor' | 'k' | 'selfWeight'>>;
  /**
   * Engram: recall with both rankers and skip the composer, so rankers can be
   * compared on recall@8 at no generation cost (embeddings have their own quota).
   */
  retrievalOnly?: boolean;
  /** Engram modes: how extraction batches turns (default: one call per turn). */
  extraction?: Extraction;
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
    case 'engram_consolidated':
      return engram(item, turns, deps, { consolidate: true });
  }
}

async function engram(
  item: BenchItem,
  turns: Turn[],
  deps: ModeDeps,
  options: { consolidate?: boolean } = {},
): Promise<ModeAnswer> {
  const { db, provider } = deps;
  const { namespace } = await ensureNamespace(db, {
    slug: `bench-${item.id}-${randomUUID()}`,
    kind: 'bench',
  });
  try {
    const clock = new SimClock(turns[0]?.at ?? new Date(item.asked_at));
    const consolidation: NonNullable<ModeAnswer['consolidation']> = {
      summarized: 0,
      skipped: 0,
      promoted: 0,
      longTermFacts: 0,
      outcomes: {},
    };
    const sessionOf = (t: Turn) => t.id.split('#')[0] ?? 's';
    // Each session is consolidated "that night", before the next one starts.
    const consolidatedAt: Date[] = [];
    const consolidateSession = async (last: Turn) => {
      clock.set(new Date(last.at.getTime() + CONSOLIDATE_AFTER_MS));
      consolidatedAt.push(clock.now());
      const r = await consolidate(db, provider, {
        namespaceId: namespace.id,
        clock,
        maxClusters: Number.POSITIVE_INFINITY,
      });
      consolidation.summarized += r.summarized;
      consolidation.skipped += r.skipped;
      consolidation.promoted += r.promoted;
      for (const [k, n] of Object.entries(r.outcomes)) {
        consolidation.outcomes[k] = (consolidation.outcomes[k] ?? 0) + n;
      }
    };
    const extraction = deps.extraction ?? 'turn';
    if (extraction === 'turn') {
      for (const [i, t] of turns.entries()) {
        const prev = turns[i - 1];
        if (options.consolidate && prev && sessionOf(prev) !== sessionOf(t)) {
          await consolidateSession(prev);
        }
        clock.set(t.at);
        const episode = await ingest(
          db,
          provider,
          {
            namespaceId: namespace.id,
            sessionId: sessionOf(t),
            role: t.role,
            content: t.text,
            occurredAt: t.at,
          },
          { clock },
        );
        await processEpisode(db, provider, episode.id, { clock });
      }
    } else {
      // Each turn is learned when it was said; facts are recorded at their cited turn.
      const sessions: Turn[][] = [];
      for (const t of turns) {
        const open = sessions.at(-1);
        if (open?.[0] && sessionOf(open[0]) === sessionOf(t)) open.push(t);
        else sessions.push([t]);
      }
      const pending: string[] = [];
      for (const session of sessions) {
        const episodes = await ingestMany(
          db,
          provider,
          session.map((t) => ({
            namespaceId: namespace.id,
            sessionId: sessionOf(t),
            role: t.role,
            content: t.text,
            occurredAt: t.at,
            createdAt: t.at,
          })),
        );
        pending.push(...episodes.map((e) => e.id));
        if (extraction === 'session') {
          const last = session.at(-1);
          if (last) clock.set(last.at);
          await processSessions(db, provider, pending.splice(0), {
            maxSessions: 1,
            recordTime: 'cited',
            clock,
          });
          if (options.consolidate && last && session !== sessions.at(-1)) {
            await consolidateSession(last);
          }
        }
      }
      if (pending.length > 0) {
        const last = turns.at(-1);
        if (last) clock.set(last.at);
        await processSessions(db, provider, pending, {
          maxTokens: PACK_TOKENS,
          recordTime: 'cited',
          clock,
        });
      }
    }
    const last = turns.at(-1);
    if (options.consolidate && last) {
      await consolidateSession(last);
      const [row] = await db<{ n: number }[]>`
        select count(*)::int as n from facts
        where namespace_id = ${namespace.id} and tier = 'long_term' and invalidated_at is null`;
      consolidation.longTermFacts = row?.n ?? 0;
      // New originals recorded at a consolidation time were inserted by it.
      const inserted = await db<{ statement: string }[]>`
        select statement from facts
        where namespace_id = ${namespace.id} and revises is null
          and recorded_at = any(${db.array(consolidatedAt, 1185)}::timestamptz[])
        order by statement`;
      consolidation.inserted = inserted.map((r) => r.statement);
    }

    clock.set(item.asked_at);
    const ask = (overrides: ModeDeps['recall']) =>
      recall(
        db,
        provider,
        {
          namespaceId: namespace.id,
          query: item.question,
          validAt: item.valid_at ? new Date(item.valid_at) : undefined,
          knownAt: item.known_at ? new Date(item.known_at) : undefined,
          trackAccess: false,
          ...overrides,
        },
        clock,
      );

    if (deps.retrievalOnly) {
      const [rrf, linear] = [
        await ask({ ...deps.recall, ranker: 'rrf', floor: 0 }),
        await ask({ ...deps.recall, ranker: 'linear', floor: 0 }),
      ];
      return {
        answer: '(retrieval only)',
        supported: false,
        usedMemoryIds: [],
        memories: rrf.memories.length,
        retrieved: rrf.memories.map((m) => m.text),
        retrievedBy: {
          rrf: rrf.memories.map((m) => m.text),
          linear: linear.memories.map((m) => m.text),
        },
        bestSimilarity: rrf.bestSimilarity,
        floor: 0,
        store: await storeStats(db, namespace.id),
      };
    }

    const result = await ask(deps.recall);
    const memories = result.memories.map((m): Memory => ({
      id: m.id,
      kind: m.kind,
      text: m.kind === 'episode' ? spoken(m.role, m.text) : m.text,
      validFrom: m.validFrom,
      validTo: m.validTo,
    }));
    const answer = await compose(provider, item, memories);
    return {
      ...answer,
      retrieved: memories.map((m) => m.text),
      bestSimilarity: result.bestSimilarity,
      floor: deps.recall?.floor ?? config.recall.floor,
      store: await storeStats(db, namespace.id),
      ...(options.consolidate ? { consolidation } : {}),
    };
  } finally {
    await db`delete from namespaces where id = ${namespace.id}`;
  }
}

async function storeStats(db: Sql, namespaceId: string): Promise<NonNullable<ModeAnswer['store']>> {
  const [row] = await db<
    {
      facts: number;
      adHoc: number;
      entities: number;
      duplicateEntities: number;
      revisions: number;
      llmRevisions: number;
    }[]
  >`
    select
      (select count(*)::int from facts where namespace_id = ${namespaceId} and invalidated_at is null) as facts,
      (select count(*)::int from facts where namespace_id = ${namespaceId} and invalidated_at is null and predicate_ad_hoc) as ad_hoc,
      (select count(*)::int from entities where namespace_id = ${namespaceId} and not is_self) as entities,
      (select coalesce(sum(n - 1), 0)::int from (
         select count(*) as n from entities where namespace_id = ${namespaceId} and not is_self
         group by lower(name) having count(*) > 1) d) as duplicate_entities,
      (select count(*)::int from fact_revisions where namespace_id = ${namespaceId}) as revisions,
      (select count(*)::int from fact_revisions where namespace_id = ${namespaceId} and resolver = 'llm') as llm_revisions`;
  return (
    row ?? { facts: 0, adHoc: 0, entities: 0, duplicateEntities: 0, revisions: 0, llmRevisions: 0 }
  );
}
