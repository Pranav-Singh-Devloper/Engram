import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { config } from '../config/index.js';
import { getFact } from '../db/facts.js';
import { forget } from '../forget/forget.js';
import { processEpisode } from '../ingest/process.js';
import { SELF_REF } from '../providers/contracts.js';
import type { FactCandidate } from '../providers/contracts.js';
import { testDb, withTestNamespace } from '../testing/db.js';
import { Scenario, aboutSelf } from '../testing/scenario.js';
import { consolidate } from './consolidate.js';

const db = testDb();
afterAll(async () => {
  await db.end();
});

// Fake embeddings are bag-of-words, so unrelated test turns would drift apart.
const ONE_CLUSTER = { ...config.consolidation, driftThreshold: -1 };

const PARIS = aboutSelf('lives_in', 'Paris', { statement: 'The user lives in Paris.' });

/**
 * Scripts summarize: each candidate cites the turns whose content it lists.
 * `match` is a substring of the input; the first matching script wins.
 */
function scriptSummary(
  s: Scenario,
  summary: string,
  cites: [string[], FactCandidate][],
  match = '',
) {
  s.fake.when('summarize', match, (input) => ({
    summary,
    candidates: cites.map(([contents, candidate]) => ({
      ...candidate,
      sourceEpisodeIds: input.episodes.filter((e) => contents.includes(e.content)).map((e) => e.id),
    })),
  }));
}

async function currentFacts(s: Scenario, predicate: string) {
  return db<{ id: string; confidence: number; tier: string; sourceEpisodeIds: string[] }[]>`
    select id, confidence, tier, source_episode_ids from facts
    where namespace_id = ${s.ns.namespace.id} and predicate = ${predicate} and invalidated_at is null`;
}

async function episodes(s: Scenario) {
  return db<
    {
      id: string;
      kind: string;
      content: string;
      consolidated: boolean;
      summarizes: string[] | null;
      hasEmbedding: boolean;
      processed: boolean;
    }[]
  >`
    select id, kind, content, consolidated, summarizes, embedding is not null as has_embedding,
           processed_at is not null as processed
    from episodes where namespace_id = ${s.ns.namespace.id} order by occurred_at, kind`;
}

const run = (s: Scenario, options: Parameters<typeof consolidate>[2] = {}) =>
  consolidate(db, s.fake, {
    namespaceId: s.ns.namespace.id,
    clock: s.clock,
    cfg: ONE_CLUSTER,
    ...options,
  });

describe('consolidate: provenance and promotion', () => {
  it('confirms a fact from its own turn without new confidence, and promotes it', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await s.tell({
        at: '2024-01-15T09:00:00Z',
        content: 'I live in Paris.',
        candidates: [PARIS],
      });
      const [before] = await currentFacts(s, 'lives_in');
      expect(before?.tier).toBe('working');

      scriptSummary(s, 'The user lives in Paris.', [[['I live in Paris.'], PARIS]]);
      const r = await run(s);
      expect(r).toMatchObject({ summarized: 1, candidates: 1, promoted: 1 });
      expect(r.outcomes.merged).toBe(1);

      const after = await currentFacts(s, 'lives_in');
      expect(after).toHaveLength(1);
      expect(after[0]).toMatchObject({
        id: before?.id,
        confidence: before?.confidence,
        tier: 'long_term',
        sourceEpisodeIds: before?.sourceEpisodeIds,
      });
      expect(await s.checkInvariants()).toEqual([]);
    });
  });

  it('raises confidence only for support from a turn the fact did not cite', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await s.tell({
        at: '2024-01-15T09:00:00Z',
        content: 'I live in Paris.',
        candidates: [PARIS],
      });
      await s.tell({
        at: '2024-01-15T09:05:00Z',
        content: 'Still loving my flat here in Paris.',
        candidates: [],
      });
      const [before] = await currentFacts(s, 'lives_in');

      scriptSummary(s, 'The user lives in Paris and loves it.', [
        [['I live in Paris.', 'Still loving my flat here in Paris.'], PARIS],
      ]);
      await run(s);

      const [after] = await currentFacts(s, 'lives_in');
      expect(after?.confidence).toBeCloseTo(0.99, 5);
      expect(after?.sourceEpisodeIds).toHaveLength(2);
      expect(after?.sourceEpisodeIds).toEqual(
        expect.arrayContaining(before?.sourceEpisodeIds ?? []),
      );
      expect(after?.tier).toBe('long_term');
      expect(await s.checkInvariants()).toEqual([]);
    });
  });

  it('merges restatements in another tense or the other way round (bench dev-long)', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      const riley = { name: 'Riley', type: 'person', description: null } as const;
      const melbourne = (predicate: string) =>
        aboutSelf(predicate, 'Melbourne', {
          from: { kind: 'named_period', year: 2016, month: null, season: null },
          to: { kind: 'named_period', year: 2019, month: null, season: null },
        });
      const told = 'I lived in Melbourne from 2016 to 2019, and my partner is Riley.';
      await s.tell({
        at: '2024-07-10T09:00:00Z',
        content: told,
        candidates: [melbourne('lives_in'), aboutSelf('partner_of', 'Riley', { type: 'person' })],
      });
      scriptSummary(s, 'The user lived in Melbourne and has a partner, Riley.', [
        [[told], melbourne('lived_in')],
        [[told], aboutSelf('partner_of', SELF_REF, { type: 'person', subject: riley })],
      ]);
      const r = await run(s);
      expect(r.outcomes).toMatchObject({ merged: 2, inserted: 0 });
      const facts = await db<{ predicate: string; subjectId: string }[]>`
        select predicate, subject_id from facts where namespace_id = ${ns.namespace.id}`;
      expect(facts.map((f) => f.predicate).sort()).toEqual(['lives_in', 'partner_of']);
      expect(facts.every((f) => f.subjectId === ns.selfEntity.id)).toBe(true);
    });
  });

  it('never writes long_term from ordinary processing', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await s.tell({
        at: '2024-01-15T09:00:00Z',
        content: 'I live in Paris.',
        candidates: [PARIS],
      });
      await s.tell({
        at: '2024-06-10T09:00:00Z',
        content: 'I moved to Berlin.',
        candidates: [aboutSelf('lives_in', 'Berlin')],
      });
      const tiers = await db<{ tier: string }[]>`
        select distinct tier from facts where namespace_id = ${ns.namespace.id}`;
      expect(tiers.map((t) => t.tier)).toEqual(['working']);
    });
  });

  it('is the only code that writes long_term', () => {
    const src = fileURLToPath(new URL('..', import.meta.url));
    const files = (readdirSync(src, { recursive: true }) as string[])
      .filter((f) => f.endsWith('.ts') && !f.includes('.test.'))
      .filter((f) => /long_term/.test(readFileSync(join(src, f), 'utf8')))
      .map((f) => relative(src, join(src, f)).split('\\').join('/'))
      .sort();
    // The tier enum, decay's τ lookup (a read), and consolidation.
    expect(files).toEqual(['consolidate/consolidate.ts', 'decay/score.ts', 'types/index.ts']);
    expect(readFileSync(join(src, 'decay/score.ts'), 'utf8')).not.toMatch(
      /setFactTier|tier\s*=[^=]/,
    );
  });
});

describe('consolidate: withdrawn claims', () => {
  const INITECH = aboutSelf('works_at', 'Initech', {
    type: 'org',
    statement: 'The user works at Initech.',
  });
  const ACME = aboutSelf('works_at', 'Acme', {
    type: 'org',
    statement: 'The user works at Acme.',
    correction: true,
  });
  const told = async (s: Scenario) => {
    await s.tell({
      at: '2026-10-25T13:38:54Z',
      content: 'I live in Paris and work at Initech.',
      candidates: [INITECH],
    });
    await s.tell({
      at: '2026-10-25T13:39:58Z',
      content: 'Actually, I work at Acme, not Initech.',
      candidates: [ACME],
    });
  };
  const employers = async (s: Scenario) =>
    (
      await db<{ name: string }[]>`
        select o.name from facts f join entities o on o.id = f.object_id
        where f.namespace_id = ${s.ns.namespace.id} and f.predicate = 'works_at'
          and f.invalidated_at is null order by o.name`
    ).map((r) => r.name);

  // The hosted demo, 2026-10-25: the nightly run re-read the first turn and put
  // Initech back beside Acme.
  it('15. does not revive a corrected claim from the turns it was corrected after', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await told(s);
      expect(await employers(s)).toEqual(['Acme']);

      scriptSummary(s, 'The user works at Initech.', [
        [['I live in Paris and work at Initech.'], INITECH],
      ]);
      s.clock.set('2026-10-26T03:00:00Z');
      const r = await run(s);
      expect(r.outcomes.rejected).toBe(1);
      expect(r.promoted).toBe(0);
      expect(await employers(s)).toEqual(['Acme']);
      const [logged] = await db<{ reason: string }[]>`
        select reason from fact_revisions
        where namespace_id = ${ns.namespace.id} and kind = 'reject'`;
      expect(logged?.reason).toBe('withdrawn after the turns it cites');
      expect(await s.checkInvariants()).toEqual([]);
    });
  });

  it('still hears a later turn that states the claim again', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await told(s);
      await s.tell({
        at: '2026-11-02T09:00:00Z',
        content: 'Good news: Initech hired me back.',
        candidates: [INITECH],
      });
      expect(await employers(s)).toContain('Initech');
      expect(await s.checkInvariants()).toEqual([]);
    });
  });

  it('still merges a restatement of the corrected belief into it', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await told(s);
      scriptSummary(s, 'The user works at Acme.', [
        [['Actually, I work at Acme, not Initech.'], { ...ACME, isCorrection: false }],
      ]);
      const r = await run(s);
      expect(r.outcomes.merged).toBe(1);
      expect(r.promoted).toBe(1);
      expect(await employers(s)).toEqual(['Acme']);
    });
  });
});

describe('consolidate: summaries and scheduling', () => {
  it('writes a recallable summary, marks its turns, and never re-extracts it', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await s.tell({
        at: '2024-01-15T09:00:00Z',
        content: 'I live in Paris.',
        candidates: [PARIS],
      });
      await s.tell({ at: '2024-01-15T09:05:00Z', content: 'I love jazz.', candidates: [] });
      scriptSummary(s, 'The user lives in Paris and loves jazz.', []);
      await run(s);

      const rows = await episodes(s);
      const turns = rows.filter((e) => e.kind === 'turn');
      const [summary] = rows.filter((e) => e.kind === 'summary');
      expect(turns.every((t) => t.consolidated)).toBe(true);
      expect(summary).toMatchObject({
        content: 'The user lives in Paris and loves jazz.',
        hasEmbedding: true,
        processed: true,
        consolidated: true,
      });
      expect([...(summary?.summarizes ?? [])].sort()).toEqual(turns.map((t) => t.id).sort());

      const extractions = s.fake.callsTo('processEpisode').length;
      expect((await processEpisode(db, s.fake, summary?.id ?? '')).status).toBe(
        'already_processed',
      );
      expect(await run(s)).toMatchObject({ clusters: 0, summarized: 0 });
      expect(s.fake.callsTo('processEpisode')).toHaveLength(extractions);
      expect(s.fake.callsTo('summarize')).toHaveLength(1);
    });
  });

  it('marks low-importance clusters consolidated without a model call', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await s.tell({
        at: '2024-01-15T09:00:00Z',
        content: 'Haha, nice.',
        candidates: [],
        importance: 0.1,
      });
      expect(await run(s)).toMatchObject({ clusters: 1, skipped: 1, summarized: 0 });
      expect(s.fake.callsTo('summarize')).toHaveLength(0);
      expect((await episodes(s)).map((e) => [e.kind, e.consolidated])).toEqual([['turn', true]]);
    });
  });

  it('caps model calls per run and leaves the rest for the next one', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await s.tell({ at: '2024-01-15T09:00:00Z', content: 'I live in Paris.', candidates: [] });
      await s.tell({ at: '2024-01-15T09:05:00Z', content: 'I love jazz.', candidates: [] });
      scriptSummary(s, 'A summary.', []);
      const cfg = { ...ONE_CLUSTER, maxClusterSize: 1 };
      expect(await run(s, { cfg, maxClusters: 1 })).toMatchObject({ summarized: 1, remaining: 1 });
      expect(await run(s, { cfg, maxClusters: 1 })).toMatchObject({ summarized: 1, remaining: 0 });
    });
  });

  it('regenerates a summary a purge deleted, and re-embeds the redacted turns', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await s.tell({
        at: '2024-01-15T09:00:00Z',
        content: 'I live in Paris and I love jazz.',
        candidates: [PARIS, aboutSelf('likes', 'jazz', { type: 'concept' })],
      });
      await s.tell({
        at: '2024-01-15T09:05:00Z',
        content: 'Jazz bars are my thing.',
        candidates: [],
      });
      scriptSummary(s, 'The user lives in Paris and loves jazz.', [], 'Paris');
      await run(s);

      const [paris] = await currentFacts(s, 'lives_in');
      const purge = await forget(
        db,
        { namespaceId: ns.namespace.id, factId: paris?.id, mode: 'hard', confirmHard: true },
        s.clock,
      );
      expect(purge.purge?.summariesDeleted).toBe(1);
      let rows = await episodes(s);
      expect(rows.map((e) => [e.kind, e.consolidated, e.hasEmbedding])).toEqual([
        ['turn', false, false],
        ['turn', false, true],
      ]);

      scriptSummary(s, 'The user loves jazz.', [], 'redacted');
      const r = await run(s);
      expect(r).toMatchObject({ reembedded: 1, summarized: 1 });
      rows = await episodes(s);
      expect(rows.map((e) => [e.kind, e.consolidated, e.hasEmbedding])).toEqual([
        ['turn', true, true],
        ['summary', true, true],
        ['turn', true, true],
      ]);
      expect(rows.some((e) => e.content.includes('Paris'))).toBe(false);
      // The purged fact stays gone: the regenerated summary cited nothing.
      expect(await getFact(db, paris?.id ?? '')).toBeUndefined();
    });
  });
});
