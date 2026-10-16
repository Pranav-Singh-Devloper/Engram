import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, expectTypeOf, it } from 'vitest';
import { basisVector, testDb, withTestNamespace } from '../testing/db.js';
import { UNKNOWN_START, transaction } from './client.js';
import { getEntity, insertEntity } from './entities.js';
import { getEpisode, insertEpisode } from './episodes.js';
import { insertFactRevision, listFactRevisions } from './factRevisions.js';
import * as facts from './facts.js';
import { ensureNamespace, getSelfEntity } from './namespaces.js';
import { toSql } from './vector.js';

const db = testDb();
afterAll(async () => {
  await db.end();
});

describe('pgvector', () => {
  it('round-trips an embedding exactly', async () => {
    await withTestNamespace(db, async ({ namespace }) => {
      // Multiples of 1/8 are exact in float4.
      const embedding = Array.from({ length: 768 }, (_, i) => ((i % 17) - 8) / 8);
      const stored = await insertEpisode(db, {
        namespaceId: namespace.id,
        sessionId: 's1',
        role: 'user',
        content: 'hello',
        embedding,
      });
      expect((await getEpisode(db, stored.id))?.embedding).toEqual(embedding);
    });
  });

  it('finds the nearest neighbour through the HNSW index', async () => {
    await withTestNamespace(db, async ({ namespace }) => {
      for (const i of [0, 1, 2]) {
        await insertEpisode(db, {
          namespaceId: namespace.id,
          sessionId: 's1',
          role: 'user',
          content: `episode ${i}`,
          embedding: basisVector(i),
        });
      }
      const query = toSql(basisVector(1, 0.9).map((x, i) => (i === 2 ? 0.1 : x)));

      await transaction(db, async (tx) => {
        // Three rows would normally be a sequential scan; force the index so
        // the test proves the operator class and index work together.
        await tx`set local enable_seqscan = off`;
        await tx`set local hnsw.ef_search = 40`;
        const plan = await tx<Record<string, string>[]>`
          explain select id from episodes order by embedding <=> ${query} limit 1`;
        // The column is "QUERY PLAN", which the camelCase transform mangles.
        const lines = plan.map((r) => Object.values(r).join(''));
        expect(lines.join('\n')).toContain('episodes_embedding_hnsw');

        const [nearest] = await tx<{ content: string }[]>`
          select content from episodes where namespace_id = ${namespace.id}
          order by embedding <=> ${query} limit 1`;
        expect(nearest?.content).toBe('episode 1');
      });
    });
  });
});

describe('ensureNamespace', () => {
  it('creates exactly one self entity and is idempotent', async () => {
    const slug = `ns-${randomUUID()}`;
    const first = await ensureNamespace(db, { slug });
    try {
      const again = await ensureNamespace(db, { slug });
      expect(again.namespace.id).toBe(first.namespace.id);
      expect(again.selfEntity.id).toBe(first.selfEntity.id);
      expect(first.selfEntity).toMatchObject({ isSelf: true, name: 'User', type: 'person' });

      const selves = await db`
        select 1 from entities where namespace_id = ${first.namespace.id} and is_self`;
      expect(selves).toHaveLength(1);
    } finally {
      await db`delete from namespaces where id = ${first.namespace.id}`;
    }
  });

  it('is safe under concurrent calls for the same slug', async () => {
    const slug = `ns-${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => ensureNamespace(db, { slug })),
    );
    const id = results[0]?.namespace.id;
    try {
      expect(new Set(results.map((r) => r.namespace.id)).size).toBe(1);
      expect(new Set(results.map((r) => r.selfEntity.id)).size).toBe(1);
    } finally {
      await db`delete from namespaces where id = ${id ?? null}`;
    }
  });

  it('refuses to reuse a slug with a different kind', async () => {
    const slug = `ns-${randomUUID()}`;
    const { namespace } = await ensureNamespace(db, { slug, kind: 'demo' });
    try {
      await expect(ensureNamespace(db, { slug, kind: 'user' })).rejects.toThrow(/kind demo/);
    } finally {
      await db`delete from namespaces where id = ${namespace.id}`;
    }
  });

  it('runs inside an outer transaction as a savepoint', async () => {
    const slug = `ns-${randomUUID()}`;
    const rollback = new Error('rollback');
    await expect(
      transaction(db, async (tx) => {
        const { namespace } = await ensureNamespace(tx, { slug });
        expect((await getSelfEntity(tx, namespace.id)).isSelf).toBe(true);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(await db`select 1 from namespaces where slug = ${slug}`).toHaveLength(0);
  });
});

describe('entities', () => {
  it('stores aliases, description and embedding', async () => {
    await withTestNamespace(db, async ({ namespace }) => {
      const sam = await insertEntity(db, {
        namespaceId: namespace.id,
        name: 'Sam',
        type: 'person',
        aliases: ['Samuel'],
        description: "the user's brother, a chef",
        embedding: basisVector(5),
      });
      expect(await getEntity(db, sam.id)).toEqual(sam);
      expect(sam).toMatchObject({ aliases: ['Samuel'], isSelf: false });
      expect(sam.embedding?.[5]).toBe(1);
    });
  });
});

describe('facts', () => {
  const recordedAt = new Date('2024-06-01T00:00:00Z');

  it('stores a fact with defaults from the schema', async () => {
    await withTestNamespace(db, async ({ namespace, selfEntity }) => {
      const fact = await facts.insertFact(db, {
        namespaceId: namespace.id,
        subjectId: selfEntity.id,
        predicate: 'lives_in',
        objectLiteral: 'Paris',
        statement: 'The user lives in Paris',
        validFrom: new Date('2024-01-01T00:00:00Z'),
        recordedAt,
      });
      expect(fact).toMatchObject({
        status: 'active',
        tier: 'working',
        confidence: expect.closeTo(0.8, 5) as number,
        validFromSource: 'episode',
        invalidatedAt: null,
        sourceEpisodeIds: [],
        embedding: null,
        recordedAt,
      });
      expect(await facts.getFact(db, fact.id)).toEqual(fact);
    });
  });

  it('round-trips an unknown start through -infinity', async () => {
    await withTestNamespace(db, async ({ namespace, selfEntity }) => {
      const fact = await facts.insertFact(db, {
        namespaceId: namespace.id,
        subjectId: selfEntity.id,
        predicate: 'lives_in',
        objectLiteral: 'Marseille',
        statement: 'The user lived in Marseille.',
        validFrom: UNKNOWN_START,
        validFromSource: 'unknown',
        validTo: new Date('2015-01-01T00:00:00Z'),
        recordedAt,
      });
      expect(fact.validFrom).toEqual(UNKNOWN_START);
      const [row] = await db<
        { v: string }[]
      >`select valid_from::text as v from facts where id = ${fact.id}`;
      expect(row?.v).toBe('-infinity');
      // The canonical predicate needs no special case: -infinity precedes every instant.
      const [hit] = await db`
        select 1 from facts where id = ${fact.id}
          and valid_from <= ${new Date('1900-01-01T00:00:00Z')}`;
      expect(hit).toBeDefined();
    });
  });

  it('invalidates a row once, and only once', async () => {
    await withTestNamespace(db, async ({ namespace, selfEntity }) => {
      const fact = await facts.insertFact(db, {
        namespaceId: namespace.id,
        subjectId: selfEntity.id,
        predicate: 'lives_in',
        objectLiteral: 'Paris',
        statement: 'The user lives in Paris',
        validFrom: new Date('2024-01-01T00:00:00Z'),
        recordedAt,
      });
      const at = new Date('2024-07-01T00:00:00Z');
      const retracted = await facts.invalidateFact(db, fact.id, { at, status: 'retracted' });
      expect(retracted).toMatchObject({ invalidatedAt: at, status: 'retracted' });
      await expect(facts.invalidateFact(db, fact.id, { at, status: 'retracted' })).rejects.toThrow(
        /already invalidated/,
      );
    });
  });

  it('batches access tracking', async () => {
    await withTestNamespace(db, async ({ namespace, selfEntity }) => {
      const base = {
        namespaceId: namespace.id,
        subjectId: selfEntity.id,
        predicate: 'likes',
        validFrom: new Date('2024-01-01T00:00:00Z'),
        recordedAt,
      };
      const a = await facts.insertFact(db, { ...base, objectLiteral: 'tea', statement: 'tea' });
      const b = await facts.insertFact(db, { ...base, objectLiteral: 'jazz', statement: 'jazz' });
      const at = new Date('2024-08-01T00:00:00Z');
      await facts.recordFactAccess(db, [a.id, b.id], at);
      await facts.recordFactAccess(db, [a.id], at);
      expect(await facts.getFact(db, a.id)).toMatchObject({ accessScore: 2, lastAccessedAt: at });
      expect(await facts.getFact(db, b.id)).toMatchObject({ accessScore: 1 });
    });
  });

  it('expose no way to change content or validity in place', () => {
    // Fact rows are immutable versions (SPEC §5.1). A new export here needs a
    // deliberate change to this list.
    expectTypeOf<keyof typeof facts>().toEqualTypeOf<
      | 'insertFact'
      | 'getFact'
      | 'invalidateFact'
      | 'setFactTier'
      | 'setFactPinned'
      | 'recordFactAccess'
    >();
    // @ts-expect-error record time must come from the engine clock
    const missingRecordedAt: facts.NewFact = {
      namespaceId: 'n',
      subjectId: 's',
      predicate: 'p',
      statement: 's',
      validFrom: new Date(),
    };
    expect(missingRecordedAt).toBeDefined();
  });
});

describe('fact revisions', () => {
  it('store the candidate payload as jsonb', async () => {
    await withTestNamespace(db, async ({ namespace }) => {
      const candidate = {
        subject: 'SELF',
        predicate: 'lives_in',
        object: 'Paris',
        confidence: 0.3,
      };
      await insertFactRevision(db, {
        namespaceId: namespace.id,
        kind: 'reject',
        resolver: 'rule',
        candidate,
        reason: 'noise',
      });
      const [revision] = await listFactRevisions(db, namespace.id);
      expect(revision).toMatchObject({
        kind: 'reject',
        candidate,
        reason: 'noise',
        oldFactId: null,
      });
    });
  });
});
