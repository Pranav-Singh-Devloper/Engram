import { afterAll, describe, expect, it } from 'vitest';
import { getFact } from '../db/facts.js';
import { insertEpisode } from '../db/episodes.js';
import { listFactRevisions } from '../db/factRevisions.js';
import type { Sql } from '../db/client.js';
import { recall } from '../retrieve/recall.js';
import { testDb, withTestNamespace } from '../testing/db.js';
import { Scenario, aboutSelf, hint } from '../testing/scenario.js';
import { ForgetError, forget, restore } from './forget.js';
import { REDACTED } from './purge.js';

const db = testDb();
afterAll(async () => {
  await db.end();
});

const NOW = '2024-09-01T00:00:00Z';

async function history(s: Scenario) {
  await s.tell({
    at: '2024-01-15T09:00:00Z',
    content: 'I live in Paris and I love jazz.',
    candidates: [
      aboutSelf('lives_in', 'Paris', { statement: 'The user lives in Paris.' }),
      aboutSelf('likes', 'jazz', { type: 'concept', statement: 'The user likes jazz.' }),
    ],
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
  await s.tell({
    at: '2024-08-01T09:00:00Z',
    content: 'Before Paris I lived in Lyon, 2015 to 2018.',
    candidates: [
      aboutSelf('lives_in', 'Lyon', {
        from: hint.year(2015),
        to: hint.year(2018),
        statement: 'The user lived in Lyon.',
      }),
    ],
  });
  s.clock.set(NOW);
}

const factId = async (s: Scenario, statement: string) => {
  const [row] = await db<{ id: string }[]>`
    select id from facts where namespace_id = ${s.ns.namespace.id} and statement = ${statement} and invalidated_at is null`;
  if (!row) throw new Error(`no current fact "${statement}"`);
  return row.id;
};

/** Every place the word could survive, counted. */
async function traces(sql: Sql, namespaceId: string, word: string) {
  const [row] = await sql<Record<string, number>[]>`
    select
      (select count(*)::int from facts where namespace_id = ${namespaceId}
         and to_tsvector('english', statement) @@ plainto_tsquery('english', ${word})) as facts,
      (select count(*)::int from episodes where namespace_id = ${namespaceId}
         and to_tsvector('english', content) @@ plainto_tsquery('english', ${word})) as episodes,
      (select count(*)::int from fact_revisions where namespace_id = ${namespaceId}
         and candidate::text ilike ${`%${word}%`}) as revisions,
      (select count(*)::int from entities where namespace_id = ${namespaceId}
         and (name ilike ${word} or exists (select 1 from unnest(aliases) a where a ilike ${word}))) as entities`;
  return row;
}

describe('forget: archive, restore, retract', () => {
  it('archives reversibly, out of default recall, with revisions both ways', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await history(s);
      const jazz = await factId(s, 'The user likes jazz.');
      await forget(db, { namespaceId: ns.namespace.id, factId: jazz, mode: 'archive' }, s.clock);
      expect((await getFact(db, jazz))?.tier).toBe('archived');
      const r = await recall(
        db,
        s.fake,
        { namespaceId: ns.namespace.id, query: 'jazz', floor: 0, trackAccess: false },
        s.clock,
      );
      expect(r.memories.some((m) => m.id === jazz)).toBe(false);

      s.clock.advance(60_000);
      await restore(db, { namespaceId: ns.namespace.id, factId: jazz }, s.clock);
      expect((await getFact(db, jazz))?.tier).toBe('working');
      const kinds = (await listFactRevisions(db, ns.namespace.id)).map(
        (x) => `${x.kind}/${x.resolver}`,
      );
      expect(kinds.slice(-2)).toEqual(['archive/manual', 'restore/manual']);
    });
  });

  it('retracts: gone for knownAt at or after the retraction, still there before', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await history(s);
      const jazz = await factId(s, 'The user likes jazz.');
      await forget(db, { namespaceId: ns.namespace.id, factId: jazz, mode: 'retract' }, s.clock);
      expect(await s.values('likes')).toEqual([]);
      expect(await s.values('likes', { knownAt: '2024-08-15T00:00:00Z' })).toEqual(['jazz']);
    });
  });

  it("targets all of an entity's facts for a predicate", async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await history(s);
      const r = await forget(
        db,
        {
          namespaceId: ns.namespace.id,
          entityId: ns.selfEntity.id,
          predicate: 'lives_in',
          mode: 'archive',
        },
        s.clock,
      );
      // Berlin, the closed Paris copy and Lyon: every current lives_in belief.
      expect(r.factIds).toHaveLength(3);
    });
  });

  it('refuses a hard purge without the flag, and an empty target', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await history(s);
      const paris = await factId(s, 'The user lives in Paris.');
      await expect(
        forget(db, { namespaceId: ns.namespace.id, factId: paris, mode: 'hard' }),
      ).rejects.toThrow(ForgetError);
      expect(await getFact(db, paris)).toBeDefined();
      await expect(forget(db, { namespaceId: ns.namespace.id, mode: 'archive' })).rejects.toThrow(
        /fact id or an entity/,
      );
    });
  });
});

describe('forget: hard purge', () => {
  it('leaves no trace of the purged value anywhere it was stored', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await history(s);
      expect(await traces(db, ns.namespace.id, 'Paris')).not.toEqual({
        facts: 0,
        episodes: 0,
        revisions: 0,
        entities: 0,
      });

      const paris = await factId(s, 'The user lives in Paris.');
      const result = await forget(
        db,
        { namespaceId: ns.namespace.id, factId: paris, mode: 'hard', confirmHard: true },
        s.clock,
      );

      expect(await traces(db, ns.namespace.id, 'Paris')).toEqual({
        facts: 0,
        episodes: 0,
        revisions: 0,
        entities: 0,
      });
      // The closed copy and the open original it revised are both gone.
      expect(result.purge?.facts).toBe(2);
      expect(result.purge?.entitiesDeleted).toBe(1);
      // Berlin and Lyon survive.
      expect(await s.values('lives_in')).toEqual(['Berlin']);
      expect(await s.values('lives_in', { validAt: '2016-01-01' })).toEqual(['Lyon']);
    });
  });

  it('leaves no dangling revises or superseded_by pointers', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await history(s);
      const paris = await factId(s, 'The user lives in Paris.');
      await forget(
        db,
        { namespaceId: ns.namespace.id, factId: paris, mode: 'hard', confirmHard: true },
        s.clock,
      );
      const dangling = await db`
        select 1 from facts f
        where f.namespace_id = ${ns.namespace.id}
          and ((f.revises is not null and not exists (select 1 from facts x where x.id = f.revises))
            or (f.superseded_by is not null and not exists (select 1 from facts x where x.id = f.superseded_by)))`;
      expect(dangling).toHaveLength(0);
    });
  });

  it("redacts a shared episode instead of deleting it, keeping the other fact's provenance", async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await history(s);
      const paris = await factId(s, 'The user lives in Paris.');
      const jazz = await getFact(db, await factId(s, 'The user likes jazz.'));
      const result = await forget(
        db,
        { namespaceId: ns.namespace.id, factId: paris, mode: 'hard', confirmHard: true },
        s.clock,
      );
      // The shared source episode, and the later turn that mentions Paris.
      expect(result.purge?.episodesRedacted).toBe(2);
      const [episode] = await db<{ content: string; hasEmbedding: boolean }[]>`
        select content, embedding is not null as has_embedding from episodes where id = ${jazz?.sourceEpisodeIds[0] ?? null}`;
      // Only the purged value is redacted; the rest of the turn survives.
      expect(episode).toEqual({
        content: `I live in ${REDACTED} and I love jazz.`,
        hasEmbedding: false,
      });
      expect((await getFact(db, jazz?.id ?? ''))?.sourceEpisodeIds).toEqual(jazz?.sourceEpisodeIds);
    });
  });

  it('deletes an episode that only backed the purged fact, and summaries built on it', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await history(s);
      const lyon = await factId(s, 'The user lived in Lyon.');
      const [source] = (await getFact(db, lyon))?.sourceEpisodeIds ?? [];
      await insertEpisode(db, {
        namespaceId: ns.namespace.id,
        sessionId: 's1',
        kind: 'summary',
        role: 'system',
        content: 'The user lived in Lyon before Paris.',
        summarizes: source ? [source] : [],
      });
      const result = await forget(
        db,
        { namespaceId: ns.namespace.id, factId: lyon, mode: 'hard', confirmHard: true },
        s.clock,
      );
      expect(result.purge).toMatchObject({ episodesDeleted: 1, summariesDeleted: 1 });
      expect(await traces(db, ns.namespace.id, 'Lyon')).toEqual({
        facts: 0,
        episodes: 0,
        revisions: 0,
        entities: 0,
      });
    });
  });
});
