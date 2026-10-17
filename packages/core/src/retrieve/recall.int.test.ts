// Retrieval fixtures for recall() (SPEC §6.2), on stores built through the
// real write path. Fake embeddings are bag-of-words, so tests pass `floor: 0`
// unless they test the floor itself.
import { afterAll, describe, expect, it } from 'vitest';
import { SimClock } from '../config/clock.js';
import { listFactRevisions } from '../db/factRevisions.js';
import { testDb, withTestNamespace } from '../testing/db.js';
import { Scenario, aboutSelf, hint } from '../testing/scenario.js';
import { recall } from './recall.js';
import type { RecallOptions } from './recall.js';

const db = testDb();
afterAll(async () => {
  await db.end();
});

const NOW = '2024-09-01T00:00:00Z';

async function moved(s: Scenario) {
  await s.tell({
    at: '2024-01-15T09:00:00Z',
    content: 'I live in Paris.',
    candidates: [aboutSelf('lives_in', 'Paris', { statement: 'The user lives in Paris.' })],
  });
  await s.tell({
    at: '2024-06-10T09:00:00Z',
    content: 'I moved to Berlin in March.',
    candidates: [
      aboutSelf('lives_in', 'Berlin', {
        from: hint.month(3),
        statement: 'The user lives in Berlin.',
      }),
    ],
  });
}

function ask(s: Scenario, query: string, options: Partial<RecallOptions> = {}) {
  s.clock.set(NOW);
  return recall(
    db,
    s.fake,
    { namespaceId: s.ns.namespace.id, query, floor: 0, trackAccess: false, ...options },
    s.clock,
  );
}

const factTexts = (r: Awaited<ReturnType<typeof ask>>) =>
  r.memories.filter((m) => m.kind === 'fact').map((m) => m.text);

describe('recall', () => {
  it('returns what holds now by default, and what held at validAt when asked', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await moved(s);
      expect(factTexts(await ask(s, 'Where does the user live?'))).toEqual([
        'The user lives in Berlin.',
      ]);
      const feb = await ask(s, 'Where does the user live?', {
        validAt: new Date('2024-02-01T00:00:00Z'),
      });
      expect(factTexts(feb)).toEqual(['The user lives in Paris.']);
      expect(feb.memories.find((m) => m.kind === 'fact')?.validTo).toEqual(
        new Date('2024-03-01T00:00:00Z'),
      );
    });
  });

  it('answers from what was believed at knownAt, for facts and episodes alike', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await moved(s);
      const may = new Date('2024-05-01T00:00:00Z');
      const r = await ask(s, 'Where does the user live?', { validAt: may, knownAt: may });
      expect(factTexts(r)).toEqual(['The user lives in Paris.']);
      expect(r.memories.find((m) => m.kind === 'fact')?.validTo).toBeNull();
      // The June episode hadn't been said, let alone recorded, in May.
      expect(r.memories.filter((m) => m.kind === 'episode').map((m) => m.text)).toEqual([
        'I live in Paris.',
      ]);
    });
  });

  it('expands one hop through the graph: "my sister" reaches her city', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      const leila = { name: 'Leila', type: 'person' as const, description: "the user's sister" };
      await s.tell({
        at: '2024-02-22T09:00:00Z',
        content: 'My sister Leila is over in Lisbon.',
        candidates: [
          aboutSelf('sibling_of', 'Leila', {
            type: 'person',
            subject: leila,
            statement: "Leila is the user's sister.",
          }),
          aboutSelf('lives_in', 'Lisbon', {
            subject: leila,
            statement: 'Leila resides in Lisbon.',
          }),
        ],
      });
      await s.tell({
        at: '2024-03-01T09:00:00Z',
        content: 'I play the cello.',
        candidates: [
          aboutSelf('plays', 'cello', { type: 'thing', statement: 'The user plays the cello.' }),
        ],
      });
      const r = await ask(s, 'Which city does my sister live in?');
      const lisbon = r.memories.find((m) => m.text === 'Leila resides in Lisbon.');
      expect(lisbon?.lists).toContain('graph');
    });
  });

  it('finds memories by full text as well as by vector', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await s.tell({
        at: '2024-04-19T09:00:00Z',
        content: "I'm allergic to penicillin.",
        candidates: [
          aboutSelf('allergic_to', 'penicillin', {
            literal: true,
            statement: 'The user is allergic to penicillin.',
          }),
        ],
      });
      const r = await ask(s, 'penicillin allergy?');
      expect(r.memories.find((m) => m.kind === 'fact')?.lists).toContain('text');
    });
  });

  it('abstains when nothing clears the similarity floor', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await moved(s);
      const r = await ask(s, 'quantum chromodynamics lattice', { floor: 0.5 });
      expect(r).toMatchObject({ memories: [], abstained: true });
    });
  });

  it('caps the result at k and supports the linear ranker', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await moved(s);
      const r = await ask(s, 'Where does the user live?', { k: 2, ranker: 'linear' });
      expect(r.memories).toHaveLength(2);
      expect(r.memories[0]?.score).toBeGreaterThanOrEqual(r.memories[1]?.score ?? 0);
    });
  });

  it('excludes the archive unless asked, and restores an archived hit when tracking', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await moved(s);
      await db`update facts set tier = 'archived' where namespace_id = ${ns.namespace.id} and statement = 'The user lives in Berlin.' and invalidated_at is null`;
      expect(factTexts(await ask(s, 'Where does the user live?'))).toEqual([]);

      const r = await ask(s, 'Where does the user live?', {
        includeArchived: true,
        trackAccess: true,
      });
      expect(factTexts(r)).toEqual(['The user lives in Berlin.']);
      const [row] = await db<{ tier: string; accessScore: number }[]>`
        select tier, access_score from facts
        where namespace_id = ${ns.namespace.id} and statement = 'The user lives in Berlin.' and invalidated_at is null`;
      expect(row).toEqual({ tier: 'working', accessScore: 1 });
      const revisions = await listFactRevisions(db, ns.namespace.id);
      expect(revisions.at(-1)).toMatchObject({ kind: 'restore' });
    });
  });

  it('tracks access only when asked', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await moved(s);
      await ask(s, 'Where does the user live?', { trackAccess: false });
      const untouched =
        await db`select 1 from facts where namespace_id = ${ns.namespace.id} and access_score > 0`;
      expect(untouched).toHaveLength(0);
      await recall(
        db,
        s.fake,
        { namespaceId: ns.namespace.id, query: 'Where does the user live?', floor: 0 },
        new SimClock(NOW),
      );
      const touched = await db<{ lastAccessedAt: Date }[]>`
        select last_accessed_at from facts where namespace_id = ${ns.namespace.id} and access_score > 0`;
      expect(touched.length).toBeGreaterThan(0);
      expect(touched[0]?.lastAccessedAt).toEqual(new Date(NOW));
    });
  });
});

describe('determinism', () => {
  it('returns the same memories in the same order for identical histories in different namespaces', async () => {
    const build = async () =>
      withTestNamespace(db, async (ns) => {
        const s = new Scenario(db, ns);
        await moved(s);
        for (const [i, food] of ['ramen', 'sushi', 'tacos', 'pho'].entries()) {
          await s.tell({
            at: `2024-07-0${i + 1}T09:00:00Z`,
            content: `I like ${food}.`,
            candidates: [
              aboutSelf('likes', food, { type: 'thing', statement: `The user likes ${food}.` }),
            ],
          });
        }
        const r = await ask(s, 'What does the user like and where does the user live?');
        return r.memories.map((m) => `${m.kind}:${m.text}`);
      });
    const [a, b] = [await build(), await build()];
    expect(a.length).toBeGreaterThan(3);
    expect(b).toEqual(a);
  });
});
