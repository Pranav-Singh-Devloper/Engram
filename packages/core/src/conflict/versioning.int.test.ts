import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { transaction } from '../db/client.js';
import { getFact, insertFact } from '../db/facts.js';
import type { NamespaceWithSelf } from '../db/namespaces.js';
import { basisVector, testDb, withTestNamespace } from '../testing/db.js';
import { reviseFact } from './versioning.js';

const db = testDb();
afterAll(async () => {
  await db.end();
});

const JAN = new Date('2024-01-15T00:00:00Z');
const MAR = new Date('2024-03-01T00:00:00Z');
const JUN = new Date('2024-06-10T00:00:00Z');

function paris({ namespace, selfEntity }: NamespaceWithSelf) {
  return insertFact(db, {
    namespaceId: namespace.id,
    subjectId: selfEntity.id,
    predicate: 'lives_in',
    objectLiteral: 'Paris',
    statement: 'The user lives in Paris.',
    embedding: basisVector(3),
    confidence: 0.8,
    validFrom: JAN,
    recordedAt: JAN,
    sourceEpisodeIds: [randomUUID()],
  });
}

describe('reviseFact', () => {
  it('writes a new version at t and invalidates the original at the same t', async () => {
    await withTestNamespace(db, async (ns) => {
      const original = await paris(ns);
      const berlinId = randomUUID();
      const closed = await transaction(db, async (tx) => {
        await insertFact(tx, {
          id: berlinId,
          namespaceId: ns.namespace.id,
          subjectId: ns.selfEntity.id,
          predicate: 'lives_in',
          objectLiteral: 'Berlin',
          statement: 'The user lives in Berlin.',
          validFrom: MAR,
          recordedAt: JUN,
        });
        return reviseFact(tx, original, { validTo: MAR, supersededBy: berlinId }, JUN);
      });

      expect(closed).toMatchObject({
        revises: original.id,
        supersededBy: berlinId,
        status: 'superseded',
        recordedAt: JUN,
        invalidatedAt: null,
        validFrom: JAN,
        validTo: MAR,
        // Content is copied, not re-derived.
        statement: original.statement,
        confidence: original.confidence,
        sourceEpisodeIds: original.sourceEpisodeIds,
        embedding: original.embedding,
      });
      expect(await getFact(db, original.id)).toMatchObject({
        invalidatedAt: JUN,
        status: 'revised',
      });
    });
  });

  it('keeps an open window active', async () => {
    await withTestNamespace(db, async (ns) => {
      const original = await paris(ns);
      const next = await reviseFact(db, original, { confidence: 0.95 }, JUN);
      expect(next).toMatchObject({ status: 'active', validTo: null });
      expect(next.confidence).toBeCloseTo(0.95, 5);
    });
  });

  it('refuses to revise a row that is no longer a current belief, rolling back', async () => {
    await withTestNamespace(db, async (ns) => {
      const original = await paris(ns);
      await reviseFact(db, original, { confidence: 0.9 }, JUN);
      await expect(
        transaction(db, (tx) => reviseFact(tx, original, { confidence: 0.99 }, JUN)),
      ).rejects.toThrow(/already invalidated/);
      const versions = await db`select 1 from facts where namespace_id = ${ns.namespace.id}`;
      expect(versions).toHaveLength(2);
    });
  });
});
