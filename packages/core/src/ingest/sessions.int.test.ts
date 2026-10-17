import { afterAll, describe, expect, it } from 'vitest';
import { SimClock } from '../config/clock.js';
import { getEpisode } from '../db/episodes.js';
import type { NamespaceWithSelf } from '../db/namespaces.js';
import type { FactCandidate, MethodInput } from '../providers/contracts.js';
import { FakeProvider } from '../providers/fake.js';
import { factsAsOf } from '../temporal/asOf.js';
import { testDb, withTestNamespace } from '../testing/db.js';
import { aboutSelf, hint } from '../testing/scenario.js';
import type { EpisodeRole } from '../types/index.js';
import { ingest } from './ingest.js';
import { packSessions, processSessions } from './sessions.js';

const db = testDb();
afterAll(async () => {
  await db.end();
});

interface Turn {
  session: string;
  at: string;
  content: string;
  role?: EpisodeRole;
}

/** Stores turns as a replay would: each learned at its own time, none processed. */
async function store(ns: NamespaceWithSelf, turns: Turn[]) {
  const ids: string[] = [];
  for (const t of turns) {
    const e = await ingest(
      db,
      new FakeProvider(),
      {
        namespaceId: ns.namespace.id,
        sessionId: t.session,
        role: t.role ?? 'user',
        content: t.content,
        occurredAt: new Date(t.at),
      },
      { clock: new SimClock(t.at) },
    );
    ids.push(e.id);
  }
  return ids;
}

/** Scripts extractSessions: candidates cite the turns whose content they list. */
function scripted(cites: [string[], FactCandidate][], importance = 0.6) {
  return new FakeProvider().when(
    'extractSessions',
    () => true,
    (input) => ({
      importance: input.turns.map((t) => ({ episodeId: t.id, importance })),
      candidates: cites
        .map(([contents, c]) => ({
          ...c,
          sourceEpisodeIds: input.turns
            .filter((t) => contents.includes(t.content))
            .map((t) => t.id),
        }))
        .filter((c) => c.sourceEpisodeIds.length > 0),
    }),
  );
}

const PARIS = 'I live in Paris.';
const BERLIN = 'I moved to Berlin in March.';
const history: Turn[] = [
  { session: 's1', at: '2024-01-15T09:00:00Z', content: PARIS },
  {
    session: 's1',
    at: '2024-01-15T09:01:00Z',
    content: 'Nice! Paris is lovely.',
    role: 'assistant',
  },
  { session: 's2', at: '2024-06-10T09:00:00Z', content: BERLIN },
];
const facts: [string[], FactCandidate][] = [
  [[PARIS], aboutSelf('lives_in', 'Paris')],
  [[BERLIN], aboutSelf('lives_in', 'Berlin', { from: hint.month(3) })],
];

async function livesIn(ns: NamespaceWithSelf, asOf: { validAt?: string; knownAt?: string }) {
  const rows = await factsAsOf(
    db,
    {
      namespaceId: ns.namespace.id,
      subjectId: ns.selfEntity.id,
      predicate: 'lives_in',
      validAt: asOf.validAt ? new Date(asOf.validAt) : undefined,
      knownAt: asOf.knownAt ? new Date(asOf.knownAt) : undefined,
    },
    new SimClock('2024-07-01T00:00:00Z'),
  );
  return rows.map((f) => f.statement).sort();
}

describe('packSessions', () => {
  const ep = (sessionId: string, content: string) =>
    ({ sessionId, content }) as Parameters<typeof packSessions>[0][number];

  it('packs whole sessions up to the budget, splitting only an oversized one', () => {
    const turns = [
      ep('a', 'x'.repeat(40)),
      ep('a', 'x'.repeat(40)),
      ep('b', 'x'.repeat(40)),
      ep('c', 'x'.repeat(400)),
    ];
    // Each 40-char turn is ~22 tokens and the 400-char one ~112: session a (44)
    // fits 60, adding b (66) doesn't, and c alone is over budget.
    const packs = packSessions(turns, { maxTokens: 60, maxSessions: Infinity });
    expect(packs.map((p) => p.map((e) => e.sessionId).join(''))).toEqual(['aa', 'b', 'c']);
    expect(
      packSessions(turns, { maxTokens: 70, maxSessions: Infinity }).map((p) => p.length),
    ).toEqual([3, 1]);
    expect(packSessions(turns, { maxTokens: 1000, maxSessions: 1 }).map((p) => p.length)).toEqual([
      2, 1, 1,
    ]);
    expect(packSessions(turns, { maxTokens: 1000, maxSessions: 10 })).toHaveLength(1);
  });
});

describe('processSessions', () => {
  it('extracts a whole history in one call, with each fact recorded when its turn was learned', async () => {
    await withTestNamespace(db, async (ns) => {
      const ids = await store(ns, history);
      const fake = scripted(facts);
      const r = await processSessions(db, fake, ids, { recordTime: 'cited' });
      expect(r).toMatchObject({ calls: 1, episodes: 3, extracted: 2, dropped: 0 });
      expect(r.outcomes).toMatchObject({ inserted: 1, updated: 1 });

      expect(await livesIn(ns, {})).toEqual(['The user lives in Berlin.']);
      // Record time is exact: before the Berlin turn was learned, Paris was believed current.
      expect(await livesIn(ns, { knownAt: '2024-05-01T00:00:00Z' })).toEqual([
        'The user lives in Paris.',
      ]);
      expect(await livesIn(ns, { validAt: '2024-02-01T00:00:00Z' })).toEqual([
        'The user lives in Paris.',
      ]);

      // Every episode is processed, with the importance the model gave it, at its own record time.
      const first = await getEpisode(db, ids[0] ?? '');
      expect(first).toMatchObject({ importance: expect.closeTo(0.6, 5) as number });
      expect(first?.processedAt?.toISOString()).toBe('2024-01-15T09:00:00.000Z');
    });
  });

  it('sends one call per session with maxSessions 1, and never re-processes', async () => {
    await withTestNamespace(db, async (ns) => {
      const ids = await store(ns, history);
      const fake = scripted(facts);
      expect(
        (await processSessions(db, fake, ids, { maxSessions: 1, recordTime: 'cited' })).calls,
      ).toBe(2);
      expect((await processSessions(db, fake, ids, { maxSessions: 1 })).calls).toBe(0);
      expect(fake.callsTo('extractSessions')).toHaveLength(2);
    });
  });

  it('cites provenance exactly, and drops facts only the assistant stated', async () => {
    await withTestNamespace(db, async (ns) => {
      const ids = await store(ns, history);
      const fake = scripted([
        [[PARIS, 'Nice! Paris is lovely.'], aboutSelf('lives_in', 'Paris')],
        [['Nice! Paris is lovely.'], aboutSelf('likes', 'Paris')],
      ]);
      const r = await processSessions(db, fake, ids, { recordTime: 'cited' });
      expect(r).toMatchObject({ extracted: 2, dropped: 1 });
      const [row] = await db<{ sourceEpisodeIds: string[] }[]>`
        select source_episode_ids from facts where namespace_id = ${ns.namespace.id}`;
      expect([...(row?.sourceEpisodeIds ?? [])].sort()).toEqual([ids[0], ids[1]].sort());
    });
  });

  it('keeps tool output and summaries away from the model, marking them processed', async () => {
    await withTestNamespace(db, async (ns) => {
      const ids = await store(ns, [
        ...history,
        {
          session: 's2',
          at: '2024-06-10T09:02:00Z',
          content: 'search results: Lyon is cheap',
          role: 'tool',
        },
      ]);
      const fake = scripted(facts);
      const r = await processSessions(db, fake, ids, { recordTime: 'cited' });
      expect(r).toMatchObject({ skipped: 1, episodes: 3 });
      const [input] = fake.callsTo('extractSessions') as MethodInput<'extractSessions'>[];
      expect(input?.turns.some((t) => t.role === 'tool')).toBe(false);
      expect((await getEpisode(db, ids[3] ?? ''))?.processedAt).not.toBeNull();
    });
  });

  it('records at the clock by default, as a live bulk import does', async () => {
    await withTestNamespace(db, async (ns) => {
      const ids = await store(ns, history.slice(0, 1));
      await processSessions(db, scripted(facts.slice(0, 1)), ids, {
        clock: new SimClock('2024-09-01T00:00:00Z'),
      });
      const [row] = await db<{ recordedAt: Date }[]>`
        select recorded_at from facts where namespace_id = ${ns.namespace.id}`;
      expect(row?.recordedAt.toISOString()).toBe('2024-09-01T00:00:00.000Z');
    });
  });
});
