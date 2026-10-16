// The SPEC §7.4 required cases, end to end: FakeProvider-scripted turns go
// through the real write path (extraction seam, entity resolution, conflict
// resolution) with a simulated clock. After every scenario the §5.1
// invariants are checked, and each turn's resolved outcomes must have written
// exactly one fact_revisions row each (plain inserts into an empty history
// write none).
import { afterAll, describe, expect, it } from 'vitest';
import { SimClock } from '../config/clock.js';
import { getFact } from '../db/facts.js';
import { listFactRevisions } from '../db/factRevisions.js';
import type { ProcessSummary } from '../ingest/process.js';
import type { ResolvedCandidate } from '../ingest/resolver.js';
import { fakeEmbedding } from '../providers/fake.js';
import { testDb, withTestNamespace } from '../testing/db.js';
import { Scenario, aboutSelf, hint } from '../testing/scenario.js';
import type { Turn } from '../testing/scenario.js';
import { createConflictResolver } from './resolver.js';

const db = testDb();
afterAll(async () => {
  await db.end();
});

const JAN = '2024-01-15T09:00:00Z';
const JUN = '2024-06-10T09:00:00Z';
const NOW = '2024-09-01T00:00:00Z';

const paris: Turn = {
  at: JAN,
  content: 'I live in Paris.',
  candidates: [aboutSelf('lives_in', 'Paris')],
};
const berlin: Turn = {
  at: JUN,
  content: 'I moved to Berlin in March.',
  candidates: [aboutSelf('lives_in', 'Berlin', { from: hint.month(3) })],
};

function resolvedOutcomes(summary: ProcessSummary): number {
  const { inserted: _inserted, ...rest } = summary.outcomes;
  return Object.values(rest).reduce((a, b) => a + b, 0);
}

/** Runs a scenario, checking revision accounting per turn and invariants at the end. */
async function run(body: (s: Scenario) => Promise<void>): Promise<void> {
  await withTestNamespace(db, async (ns) => {
    const s = new Scenario(db, ns);
    const tell = s.tell.bind(s);
    s.tell = async (turn) => {
      const result = await tell(turn);
      expect(result.revisions, `revision rows for "${turn.content}"`).toBe(
        resolvedOutcomes(result.summary),
      );
      expect(await s.checkInvariants()).toEqual([]);
      return result;
    };
    await body(s);
    s.clock.set(NOW);
    expect(await s.checkInvariants()).toEqual([]);
  });
}

describe('SPEC §7.4 required cases', () => {
  it('1. Paris → Berlin: the closed copy has the right windows, the original is revised', async () => {
    await run(async (s) => {
      await s.tell(paris);
      const { summary } = await s.tell(berlin);
      expect(summary.outcomes.updated).toBe(1);

      const rows = await db<
        {
          id: string;
          objectName: string;
          status: string;
          validFrom: Date;
          validTo: Date | null;
          recordedAt: Date;
          invalidatedAt: Date | null;
          revises: string | null;
          supersededBy: string | null;
        }[]
      >`
        select f.id, e.name as object_name, f.status, f.valid_from, f.valid_to, f.recorded_at,
               f.invalidated_at, f.revises, f.superseded_by
        from facts f join entities e on e.id = f.object_id
        where f.namespace_id = ${s.ns.namespace.id} order by f.recorded_at, f.valid_to nulls last`;
      const [original, closed, current] = [
        rows.find((r) => r.objectName === 'Paris' && r.revises === null),
        rows.find((r) => r.objectName === 'Paris' && r.revises !== null),
        rows.find((r) => r.objectName === 'Berlin'),
      ];
      expect(original).toMatchObject({
        status: 'revised',
        invalidatedAt: new Date(JUN),
        validTo: null,
      });
      expect(closed).toMatchObject({
        status: 'superseded',
        revises: original?.id,
        supersededBy: current?.id,
        validFrom: new Date(JAN),
        validTo: new Date('2024-03-01T00:00:00Z'),
        recordedAt: new Date(JUN),
        invalidatedAt: null,
      });
      expect(current).toMatchObject({
        status: 'active',
        validFrom: new Date('2024-03-01T00:00:00Z'),
        recordedAt: new Date(JUN),
      });
      expect((await listFactRevisions(db, s.ns.namespace.id)).map((r) => r.kind)).toEqual([
        'update',
      ]);
    });
  });

  it('2. validAt either side of the move returns the right city', async () => {
    await run(async (s) => {
      await s.tell(paris);
      await s.tell(berlin);
      s.clock.set(NOW);
      expect(await s.values('lives_in', { validAt: '2024-02-01' })).toEqual(['Paris']);
      expect(await s.values('lives_in', { validAt: '2024-04-01' })).toEqual(['Berlin']);
      expect(await s.values('lives_in', { validAt: '2024-01-01' })).toEqual([]);
    });
  });

  it('3. knownAt before the move was learned gives Paris as current; after, Berlin', async () => {
    await run(async (s) => {
      await s.tell(paris);
      await s.tell(berlin);
      s.clock.set(NOW);
      expect(await s.values('lives_in', { knownAt: '2024-05-01', validAt: '2024-05-01' })).toEqual([
        'Paris',
      ]);
      expect(await s.values('lives_in', { knownAt: '2024-07-01', validAt: '2024-05-01' })).toEqual([
        'Berlin',
      ]);
      expect(await s.values('lives_in')).toEqual(['Berlin']);
    });
  });

  it('4. a correction retracts: absent for knownAt ≥ the retraction, present before', async () => {
    await run(async (s) => {
      await s.tell({
        at: '2024-07-01T09:00:00Z',
        content: 'I work at Initech.',
        candidates: [aboutSelf('works_at', 'Initech', { type: 'org' })],
      });
      const { summary } = await s.tell({
        at: '2024-07-02T09:00:00Z',
        content: 'Actually, I work at Acme, not Initech.',
        candidates: [aboutSelf('works_at', 'Acme', { type: 'org', correction: true })],
      });
      expect(summary.outcomes.corrected).toBe(1);
      s.clock.set(NOW);
      expect(await s.values('works_at', { knownAt: '2024-07-01T12:00:00Z' })).toEqual(['Initech']);
      expect(await s.values('works_at', { knownAt: '2024-07-02T09:00:00Z' })).toEqual(['Acme']);
      expect(await s.values('works_at')).toEqual(['Acme']);
      // The retracted row is gone at every valid time, not just closed.
      expect(await s.values('works_at', { validAt: '2024-07-01T12:00:00Z' })).toEqual(['Acme']);
    });
  });

  it('5. out-of-order backfill: older history learned later, Berlin stays current', async () => {
    await run(async (s) => {
      await s.tell(paris);
      await s.tell(berlin);
      const { summary } = await s.tell({
        at: '2024-08-01T09:00:00Z',
        content: 'Years ago I lived in Lyon, 2015 to 2018.',
        candidates: [aboutSelf('lives_in', 'Lyon', { from: hint.year(2015), to: hint.year(2018) })],
      });
      expect(summary.outcomes.backfilled).toBe(1);
      s.clock.set(NOW);
      expect(await s.values('lives_in')).toEqual(['Berlin']);
      expect(await s.values('lives_in', { validAt: '2016-06-01' })).toEqual(['Lyon']);
      expect(await s.values('lives_in', { validAt: '2016-06-01', knownAt: '2024-07-01' })).toEqual(
        [],
      );
    });
  });

  it('6. a static-predicate contradiction resolves only as correction or reject', async () => {
    await run(async (s) => {
      const born = (date: string, correction = false) =>
        aboutSelf('birth_date', date, { literal: true, from: hint.date(date), correction });
      await s.tell({
        at: JAN,
        content: 'I was born on 4 July 1990.',
        candidates: [born('1990-07-04')],
      });

      // The adjudicator says "update", which a static predicate can't take: reject.
      s.fake.when('adjudicate', (input) => input.mutability === 'static', {
        decision: 'update',
        targetFactId: null,
        reason: 'looks like a change',
        flagPredicate: false,
      });
      const { summary } = await s.tell({
        at: JUN,
        content: 'My birthday is 5 July 1990.',
        candidates: [born('1990-07-05')],
      });
      expect(summary.outcomes).toMatchObject({ rejected: 1, updated: 0 });
      expect(s.fake.callsTo('adjudicate')).toHaveLength(1);
      expect(await s.values('birth_date', { validAt: '2000-01-01' })).toEqual(['1990-07-04']);

      // An explicit correction cue still retracts.
      const fixed = await s.tell({
        at: '2024-07-01T00:00:00Z',
        content: 'Actually I was born on 6 July 1990.',
        candidates: [born('1990-07-06', true)],
      });
      expect(fixed.summary.outcomes.corrected).toBe(1);
      s.clock.set(NOW);
      expect(await s.values('birth_date', { validAt: '2000-01-01' })).toEqual(['1990-07-06']);
    });
  });

  it('7. multi-valued predicates coexist', async () => {
    await run(async (s) => {
      await s.tell({
        at: JAN,
        content: 'I love jazz.',
        candidates: [aboutSelf('likes', 'jazz', { type: 'concept' })],
      });
      const { summary } = await s.tell({
        at: JUN,
        content: 'I love techno too.',
        candidates: [aboutSelf('likes', 'techno', { type: 'concept' })],
      });
      expect(summary.outcomes.coexisted).toBe(1);
      s.clock.set(NOW);
      expect(await s.values('likes')).toEqual(['jazz', 'techno']);
    });
  });

  it('8. a paraphrased restatement merges into the existing fact', async () => {
    await run(async (s) => {
      await s.tell(paris);
      const { summary } = await s.tell({
        at: '2024-02-01T09:00:00Z',
        content: "I'm still living in Paris these days.",
        candidates: [
          aboutSelf('lives_in', 'Paris', {
            statement: 'The user is still living in Paris these days.',
          }),
        ],
      });
      expect(summary.outcomes.merged).toBe(1);
      s.clock.set(NOW);
      const facts = await db<{ sources: number; confidence: number }[]>`
        select cardinality(source_episode_ids) as sources, confidence from facts
        where namespace_id = ${s.ns.namespace.id} and invalidated_at is null`;
      expect(facts).toHaveLength(1);
      expect(facts[0]?.sources).toBe(2);
      expect(facts[0]?.confidence).toBeCloseTo(0.99, 5);
    });
  });

  it('9. a merge with overlapping provenance does not raise confidence', async () => {
    await run(async (s) => {
      await s.tell(paris);
      const [fact] = await db<
        { id: string; sourceEpisodeIds: string[]; subjectId: string; objectId: string }[]
      >`
        select id, source_episode_ids, subject_id, object_id from facts where namespace_id = ${s.ns.namespace.id}`;
      if (!fact) throw new Error('no fact');

      // Consolidation re-extracting the same episode: same provenance.
      const again: ResolvedCandidate = {
        namespaceId: s.ns.namespace.id,
        subjectId: fact.subjectId,
        predicate: 'lives_in',
        predicateAdHoc: false,
        objectId: fact.objectId,
        objectLiteral: null,
        objectName: 'Paris',
        statement: 'The user lives in Paris.',
        embedding: fakeEmbedding('The user lives in Paris.'),
        confidence: 0.9,
        importance: 0.5,
        validFrom: new Date(JAN),
        validFromSource: 'episode',
        validTo: null,
        isCorrection: false,
        sourceEpisodeIds: fact.sourceEpisodeIds,
        raw: aboutSelf('lives_in', 'Paris'),
        context: 'I live in Paris.',
      };
      const before = await getFact(db, fact.id);
      const resolution = await createConflictResolver(s.fake).resolve(db, again, {
        clock: new SimClock(JUN),
      });
      expect(resolution).toEqual({ kind: 'merged', factId: fact.id });
      expect(await getFact(db, fact.id)).toEqual(before);
      expect((await listFactRevisions(db, s.ns.namespace.id)).map((r) => r.kind)).toEqual([
        'merge',
      ]);
    });
  });

  it('10. a low-confidence contradiction is rejected, with the candidate kept for audit', async () => {
    await run(async (s) => {
      await s.tell(paris);
      const { summary } = await s.tell({
        at: JUN,
        content: 'Maybe I live in Rome? Not sure.',
        candidates: [aboutSelf('lives_in', 'Rome', { confidence: 0.3 })],
      });
      expect(summary.outcomes.rejected).toBe(1);
      s.clock.set(NOW);
      expect(await s.values('lives_in')).toEqual(['Paris']);
      const [reject] = await listFactRevisions(db, s.ns.namespace.id);
      expect(reject).toMatchObject({ kind: 'reject', resolver: 'rule', newFactId: null });
      expect(JSON.stringify(reject?.candidate)).toContain('Rome');
    });
  });

  it('11. a synonym predicate conflicts with its registry name', async () => {
    await run(async (s) => {
      await s.tell(paris);
      const { summary } = await s.tell({
        at: JUN,
        content: "I'm based in Berlin now.",
        candidates: [aboutSelf('resides_in', 'Berlin', { from: hint.month(3) })],
      });
      expect(summary.outcomes.updated).toBe(1);
      s.clock.set(NOW);
      expect(await s.values('lives_in')).toEqual(['Berlin']);
    });
  });

  it('12. a relative date resolves against occurred_at and drives the update', async () => {
    await run(async (s) => {
      await s.tell(paris);
      await s.tell({
        at: JUN,
        content: 'I moved to Berlin last month.',
        candidates: [aboutSelf('lives_in', 'Berlin', { from: hint.ago(1, 'month') })],
      });
      s.clock.set(NOW);
      expect(await s.values('lives_in', { validAt: '2024-05-09' })).toEqual(['Paris']);
      expect(await s.values('lives_in', { validAt: '2024-05-10' })).toEqual(['Berlin']);
    });
  });

  it('13. a backfill overlapping closed history goes to the adjudicator', async () => {
    await run(async (s) => {
      await s.tell(paris);
      await s.tell(berlin);
      await s.tell({
        at: '2024-08-01T09:00:00Z',
        content: 'I lived in Lyon from 2015 to 2018.',
        candidates: [aboutSelf('lives_in', 'Lyon', { from: hint.year(2015), to: hint.year(2018) })],
      });
      s.fake.when('adjudicate', (input) => input.candidate.statement.includes('Rome'), {
        decision: 'coexist',
        targetFactId: null,
        reason: 'a second home during those years',
        flagPredicate: true,
      });
      const { summary } = await s.tell({
        at: '2024-08-15T09:00:00Z',
        content: 'I lived in Rome from 2017 to 2019.',
        candidates: [aboutSelf('lives_in', 'Rome', { from: hint.year(2017), to: hint.year(2019) })],
      });
      expect(s.fake.callsTo('adjudicate')).toHaveLength(1);
      expect(summary.outcomes.coexisted).toBe(1);
      const revisions = await listFactRevisions(db, s.ns.namespace.id);
      expect(revisions.at(-1)).toMatchObject({ kind: 'coexist', resolver: 'llm' });
      expect(revisions.at(-1)?.reason).toContain('predicate flagged');
    });
  });

  it('a history mention of an earlier value does not move the user back', async () => {
    await run(async (s) => {
      await s.tell(paris);
      await s.tell(berlin);
      s.fake.when('adjudicate', (input) => input.context.includes('Before I moved to Paris'), {
        decision: 'reject',
        targetFactId: null,
        reason: 'only mentions Paris while telling history',
        flagPredicate: false,
      });
      await s.tell({
        at: '2024-08-01T09:00:00Z',
        content: 'Before I moved to Paris I lived in Lyon from 2015 to 2018.',
        candidates: [
          aboutSelf('lives_in', 'Lyon', { from: hint.year(2015), to: hint.year(2018) }),
          aboutSelf('lives_in', 'Paris'),
        ],
      });
      s.clock.set(NOW);
      expect(await s.values('lives_in')).toEqual(['Berlin']);
      expect(await s.values('lives_in', { validAt: '2016-01-01' })).toEqual(['Lyon']);
      const [asked] = s.fake.callsTo('adjudicate') as { context: string; existing: unknown[] }[];
      expect(asked?.context).toContain('Before I moved to Paris');
    });
  });

  it('14. no knownAt gap or overlap at the update instant', async () => {
    await run(async (s) => {
      await s.tell(paris);
      await s.tell(berlin);
      s.clock.set(NOW);
      const t = new Date(JUN).getTime();
      for (const knownAt of [t - 1, t, t + 1]) {
        const believed = await db<{ n: number }[]>`
          select count(*)::int as n from facts f
          join entities e on e.id = f.object_id and e.name = 'Paris'
          where f.namespace_id = ${s.ns.namespace.id}
            and f.recorded_at <= ${new Date(knownAt)}
            and (f.invalidated_at is null or f.invalidated_at > ${new Date(knownAt)})`;
        expect(
          believed,
          `Paris rows believed at t${knownAt - t >= 0 ? '+' : ''}${knownAt - t}ms`,
        ).toEqual([{ n: 1 }]);
      }
    });
  });
});
