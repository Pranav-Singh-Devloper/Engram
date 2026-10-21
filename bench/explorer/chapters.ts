// Build-time data for the explorer's recall and consolidation chapters (P09c
// chapters 6 and 8): the floor simulations from committed dev-long runs, and
// one dev-long history consolidated through the real engine.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_DATABASE_URL, createDb } from '@engram/core';
import type { Provider, Sql } from '@engram/core';
import { PORTABLE, migrate } from '@engram/core/migrate';
import { SplitFile } from '../dataset/schema.js';
import { simulateFloor } from '../runner/report.js';
import { runMode } from '../runner/modes.js';
import { loadResults } from '../runner/run.js';

const BENCH = path.resolve(import.meta.dirname, '..');

/** Runs whose per-item best similarities feed the floor slider: one per embedder. */
export const FLOOR_RUNS = [
  { space: 'gemini-embedding-2', run: '2026-10-18-devlong-session' },
  { space: 'embeddinggemma:300m', run: '2026-10-18-devlong-local-C-guard' },
] as const;

/** Floors the bench's own simulateFloor is evaluated at, so the UI's mirror can be checked. */
export const FLOOR_GRID = [0, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6, 0.65, 0.7, 0.75, 0.8];

export function floorRuns() {
  return FLOOR_RUNS.map(({ space, run }) => {
    const composed = loadResults(path.join(BENCH, 'runs', run)).filter(
      (r) => r.mode === 'engram' && r.answer.bestSimilarity !== undefined && !r.answer.retrievedBy,
    );
    const items = composed
      .map((r) => ({
        id: r.itemId,
        category: r.category,
        best: r.answer.bestSimilarity ?? 0,
        correct: r.verdict.correct,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const ran = Math.max(...composed.map((r) => r.answer.floor ?? 0));
    return {
      space,
      run,
      ran,
      items,
      grid: FLOOR_GRID.filter((f) => f >= ran).map((f) => ({
        floor: f,
        ...simulateFloor(items, f),
      })),
    };
  });
}

export const CONSOLIDATION_ITEM = 'dev-001';

/**
 * One dev-long history through engram_consolidated, exactly as the bench runs
 * it (session extraction, consolidation after each session), with the store
 * read back before the namespace is deleted.
 */
export async function consolidationStory(provider: Provider) {
  const split = SplitFile.parse(
    JSON.parse(readFileSync(path.join(BENCH, 'dataset/dev-long.json'), 'utf8')),
  );
  const item = split.items.find((i) => i.id === CONSOLIDATION_ITEM);
  if (!item) throw new Error(`No ${CONSOLIDATION_ITEM} in dev-long.`);
  const db = createDb(process.env.DATABASE_URL || DEFAULT_DATABASE_URL, { max: 2 });
  await migrate(db, { sources: [PORTABLE] });
  const seen: { store?: Awaited<ReturnType<typeof readStore>> } = {};
  try {
    const answer = await runMode('engram_consolidated', item, {
      db,
      provider,
      extraction: 'session',
      inspect: async (tx, namespaceId) => {
        seen.store = await readStore(tx, namespaceId);
      },
    });
    if (!seen.store) throw new Error('The store was not read.');
    const { episodes, facts } = seen.store;
    const turns = episodes.filter((e) => e.kind === 'turn');
    const summaries = episodes.filter((e) => e.kind === 'summary');
    const sessions = [...new Set(turns.map((t) => t.sessionId))].map((id) => {
      const own = turns.filter((t) => t.sessionId === id);
      const ids = new Set(own.map((t) => t.id));
      const summary = summaries.find((s) => s.summarizes.some((x) => ids.has(x)));
      return {
        id,
        filler: /-f\d+$/.test(id),
        occurredAt: own[0]?.occurredAt.toISOString() ?? '',
        turns: own.map((t) => ({ content: t.content, importance: t.importance })),
        maxImportance: Math.max(...own.map((t) => t.importance)),
        summary: summary?.content ?? null,
        facts: facts
          .filter((f) => f.sourceEpisodeIds.some((x) => ids.has(x)))
          .map((f) => ({
            statement: f.statement,
            tier: f.tier,
            current: f.invalidatedAt === null,
          })),
      };
    });
    return {
      item: CONSOLIDATION_ITEM,
      question: item.question,
      expected: item.expected,
      answer: answer.answer,
      consolidation: answer.consolidation,
      sessions,
    };
  } finally {
    await db.end();
  }
}

async function readStore(db: Sql, namespaceId: string) {
  const episodes = await db<
    {
      id: string;
      sessionId: string;
      kind: 'turn' | 'summary';
      content: string;
      importance: number;
      occurredAt: Date;
      summarizes: string[];
    }[]
  >`
    select id, session_id, kind, content, importance, occurred_at, summarizes from episodes
    where namespace_id = ${namespaceId} order by occurred_at, id`;
  const facts = await db<
    {
      statement: string;
      tier: string;
      invalidatedAt: Date | null;
      sourceEpisodeIds: string[];
    }[]
  >`
    select statement, tier, invalidated_at, source_episode_ids from facts
    where namespace_id = ${namespaceId} order by recorded_at, statement`;
  return { episodes, facts };
}
