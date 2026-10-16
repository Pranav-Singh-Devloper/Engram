import { afterAll, describe, expect, it } from 'vitest';
import { createDb, DEFAULT_DATABASE_URL } from '../db/client.js';
import type { Sql } from '../db/client.js';
import { getEpisode } from '../db/episodes.js';
import type { NamespaceWithSelf } from '../db/namespaces.js';
import { SELF_REF } from '../providers/contracts.js';
import type { FactCandidate, TemporalHint } from '../providers/contracts.js';
import { FakeProvider } from '../providers/fake.js';
import { testDb, withTestNamespace } from '../testing/db.js';
import { ingest } from './ingest.js';
import { processEpisode } from './process.js';

const db = testDb();
afterAll(async () => {
  await db.end();
});

const occurredAt = new Date('2024-06-10T09:30:00Z');
const none: TemporalHint = { kind: 'none' };
const self = { name: SELF_REF, type: 'person', description: null } as const;
const place = (name: string) =>
  ({ kind: 'entity', entity: { name, type: 'place', description: null } }) as const;

function candidate(overrides: Partial<FactCandidate> = {}): FactCandidate {
  return {
    subject: self,
    predicate: 'lives_in',
    object: place('Berlin'),
    statement: 'The user lives in Berlin.',
    validFrom: none,
    validTo: none,
    isCorrection: false,
    confidence: 0.9,
    ...overrides,
  };
}

async function episode(
  ns: NamespaceWithSelf,
  fake: FakeProvider,
  content: string,
  role: 'user' | 'tool' = 'user',
) {
  return ingest(db, fake, {
    namespaceId: ns.namespace.id,
    sessionId: 's1',
    role,
    content,
    occurredAt,
  });
}

interface FactRow {
  predicate: string;
  predicateAdHoc: boolean;
  subjectId: string;
  objectName: string | null;
  objectLiteral: string | null;
  validFrom: Date;
  validFromSource: string;
  validTo: Date | null;
  sourceEpisodeIds: string[];
  importance: number;
  hasEmbedding: boolean;
}

function facts(sql: Sql, namespaceId: string) {
  return sql<FactRow[]>`
    select f.predicate, f.predicate_ad_hoc, f.subject_id, o.name as object_name, f.object_literal,
           f.valid_from, f.valid_from_source, f.valid_to, f.source_episode_ids, f.importance,
           f.embedding is not null as has_embedding
    from facts f left join entities o on o.id = f.object_id
    where f.namespace_id = ${namespaceId} order by f.created_at, f.statement`;
}

describe('processEpisode', () => {
  it('extracts, resolves and stores facts with provenance', async () => {
    await withTestNamespace(db, async (ns) => {
      const fake = new FakeProvider().when('processEpisode', 'Berlin last month', {
        importance: 0.7,
        candidates: [
          candidate({
            validFrom: { kind: 'relative', amount: 1, unit: 'month', direction: 'ago' },
          }),
        ],
      });
      const ep = await episode(ns, fake, 'I moved to Berlin last month.');

      const result = await processEpisode(db, fake, ep.id);

      expect(result).toMatchObject({
        status: 'processed',
        importance: 0.7,
        extracted: 1,
        createdEntities: 1,
        outcomes: { inserted: 1 },
      });
      const [fact] = await facts(db, ns.namespace.id);
      expect(fact).toMatchObject({
        predicate: 'lives_in',
        subjectId: ns.selfEntity.id,
        objectName: 'Berlin',
        validFrom: new Date('2024-05-10T00:00:00Z'),
        validFromSource: 'explicit',
        validTo: null,
        sourceEpisodeIds: [ep.id],
        hasEmbedding: true,
      });
      expect(fact?.importance).toBeCloseTo(0.7, 5);
      const stored = await getEpisode(db, ep.id);
      expect(stored?.processedAt).not.toBeNull();
      expect(stored?.importance).toBeCloseTo(0.7, 5);
    });
  });

  it('defaults valid_from to the episode time when the turn gives none', async () => {
    await withTestNamespace(db, async (ns) => {
      const fake = new FakeProvider().when('processEpisode', () => true, {
        importance: 0.5,
        candidates: [candidate()],
      });
      const ep = await episode(ns, fake, 'I live in Berlin.');
      await processEpisode(db, fake, ep.id);
      expect((await facts(db, ns.namespace.id))[0]).toMatchObject({
        validFrom: occurredAt,
        validFromSource: 'episode',
      });
    });
  });

  it('is idempotent', async () => {
    await withTestNamespace(db, async (ns) => {
      const fake = new FakeProvider().when('processEpisode', () => true, {
        importance: 0.5,
        candidates: [candidate()],
      });
      const ep = await episode(ns, fake, 'I live in Berlin.');
      await processEpisode(db, fake, ep.id);
      const again = await processEpisode(db, fake, ep.id);
      expect(again.status).toBe('already_processed');
      expect(fake.callsTo('processEpisode')).toHaveLength(1);
      expect(await facts(db, ns.namespace.id)).toHaveLength(1);
    });
  });

  it('never extracts from tool output by default', async () => {
    await withTestNamespace(db, async (ns) => {
      const fake = new FakeProvider();
      const ep = await episode(ns, fake, '<html>Sam lives in Rome</html>', 'tool');
      const result = await processEpisode(db, fake, ep.id);
      expect(result.status).toBe('skipped_tool');
      expect(fake.callsTo('processEpisode')).toHaveLength(0);
      expect((await getEpisode(db, ep.id))?.processedAt).not.toBeNull();
    });
  });

  it('normalizes predicates through the synonym map and flags ad-hoc ones', async () => {
    await withTestNamespace(db, async (ns) => {
      const fake = new FakeProvider().when('processEpisode', () => true, {
        importance: 0.5,
        candidates: [
          candidate({ predicate: 'based_in' }),
          candidate({
            predicate: 'allergicTo',
            object: { kind: 'literal', value: 'peanuts' },
            statement: 'The user is allergic to peanuts.',
          }),
        ],
      });
      const ep = await episode(ns, fake, 'I am based in Berlin and allergic to peanuts.');
      await processEpisode(db, fake, ep.id);
      const rows = await facts(db, ns.namespace.id);
      expect(
        rows.map((r) => [r.predicate, r.predicateAdHoc, r.objectName ?? r.objectLiteral]).sort(),
      ).toEqual([
        ['allergic_to', true, 'peanuts'],
        ['lives_in', false, 'Berlin'],
      ]);
    });
  });

  it('resolves SELF as an object, and reuses entities across candidates', async () => {
    await withTestNamespace(db, async (ns) => {
      const sam = { name: 'Sam', type: 'person', description: "the user's manager" } as const;
      const fake = new FakeProvider().when('processEpisode', () => true, {
        importance: 0.6,
        candidates: [
          candidate({
            subject: sam,
            predicate: 'manager_of',
            object: { kind: 'entity', entity: self },
            statement: 'Sam is the user’s manager.',
          }),
          candidate({ subject: sam, object: place('Lyon'), statement: 'Sam lives in Lyon.' }),
        ],
      });
      const ep = await episode(ns, fake, 'Sam, my manager, lives in Lyon.');
      const result = await processEpisode(db, fake, ep.id);
      expect(result.createdEntities).toBe(2);
      const rows = await facts(db, ns.namespace.id);
      const subjects = new Set(rows.map((r) => r.subjectId));
      expect(subjects.size).toBe(1);
      expect(rows.find((r) => r.predicate === 'manager_of')?.objectName).toBe('User');
    });
  });

  it('drops an end bound that is not after the start, and keeps the fact', async () => {
    await withTestNamespace(db, async (ns) => {
      const fake = new FakeProvider().when('processEpisode', () => true, {
        importance: 0.5,
        candidates: [
          candidate({
            validFrom: { kind: 'named_period', year: 2020, month: null, season: null },
            validTo: { kind: 'named_period', year: 2018, month: null, season: null },
          }),
        ],
      });
      const ep = await episode(ns, fake, 'I lived in Berlin from 2020 to 2018.');
      const result = await processEpisode(db, fake, ep.id);
      expect(result.droppedBounds).toBe(1);
      expect((await facts(db, ns.namespace.id))[0]?.validTo).toBeNull();
    });
  });

  it('ends a window at the start of the named period, meeting the next one', async () => {
    await withTestNamespace(db, async (ns) => {
      const year = (y: number) =>
        ({ kind: 'named_period', year: y, month: null, season: null }) as const;
      const fake = new FakeProvider().when('processEpisode', () => true, {
        importance: 0.5,
        candidates: [
          candidate({ object: place('Lyon'), validFrom: year(2015), validTo: year(2018) }),
          candidate({ object: place('Paris'), validFrom: year(2018) }),
        ],
      });
      const ep = await episode(ns, fake, 'Lyon from 2015 to 2018, Paris since 2018.');
      await processEpisode(db, fake, ep.id);
      const rows = await facts(db, ns.namespace.id);
      expect(rows.find((r) => r.objectName === 'Lyon')?.validTo).toEqual(
        new Date('2018-01-01T00:00:00Z'),
      );
      expect(rows.find((r) => r.objectName === 'Paris')?.validFrom).toEqual(
        new Date('2018-01-01T00:00:00Z'),
      );
    });
  });

  it('spans a period named at both ends', async () => {
    await withTestNamespace(db, async (ns) => {
      const summer = { kind: 'named_period', year: 2023, month: null, season: 'summer' } as const;
      const fake = new FakeProvider().when('processEpisode', () => true, {
        importance: 0.5,
        candidates: [candidate({ validFrom: summer, validTo: summer })],
      });
      const ep = await episode(ns, fake, 'I lived in Berlin in summer 2023.');
      await processEpisode(db, fake, ep.id);
      expect((await facts(db, ns.namespace.id))[0]).toMatchObject({
        validFrom: new Date('2023-06-01T00:00:00Z'),
        validTo: new Date('2023-09-01T00:00:00Z'),
      });
    });
  });

  it('drops a fact that ended before the turn when its start is unknown', async () => {
    await withTestNamespace(db, async (ns) => {
      const fake = new FakeProvider().when('processEpisode', () => true, {
        importance: 0.5,
        candidates: [
          candidate({
            object: place('Marseille'),
            validTo: { kind: 'named_period', year: 2015, month: null, season: null },
          }),
        ],
      });
      const ep = await episode(ns, fake, 'Before that I lived in Marseille.');
      const result = await processEpisode(db, fake, ep.id);
      expect(result).toMatchObject({ dropped: 1, outcomes: { inserted: 0 } });
      expect(await facts(db, ns.namespace.id)).toHaveLength(0);
    });
  });

  it('drops a candidate whose predicate normalizes to nothing', async () => {
    await withTestNamespace(db, async (ns) => {
      const fake = new FakeProvider().when('processEpisode', () => true, {
        importance: 0.5,
        candidates: [candidate({ predicate: '--' }), candidate()],
      });
      const ep = await episode(ns, fake, 'I live in Berlin.');
      const result = await processEpisode(db, fake, ep.id);
      expect(result).toMatchObject({ extracted: 2, dropped: 1, outcomes: { inserted: 1 } });
    });
  });

  it('creates one entity when episodes mentioning it are processed concurrently', async () => {
    const wide = createDb(process.env.DATABASE_URL || DEFAULT_DATABASE_URL, { max: 10 });
    try {
      await withTestNamespace(db, async (ns) => {
        const alice = { name: 'Alice', type: 'person', description: "the user's friend" } as const;
        const fake = new FakeProvider().when('processEpisode', () => true, {
          importance: 0.5,
          candidates: [
            candidate({
              predicate: 'friend_of',
              object: { kind: 'entity', entity: alice },
              statement: 'Alice is a friend of the user.',
            }),
          ],
        });
        const episodes = await Promise.all(
          Array.from({ length: 10 }, (_, i) => episode(ns, fake, `Alice and I met up (${i}).`)),
        );
        await Promise.all(episodes.map((ep) => processEpisode(wide, fake, ep.id)));
        const alices = await db`
          select 1 from entities where namespace_id = ${ns.namespace.id} and name = 'Alice'`;
        expect(alices).toHaveLength(1);
        expect(await facts(db, ns.namespace.id)).toHaveLength(10);
      });
    } finally {
      await wide.end();
    }
  });
});
