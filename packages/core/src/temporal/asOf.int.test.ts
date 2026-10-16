// The canonical filter against hand-built rows, independent of the resolver
// that normally writes them. The scenario: Paris believed from January; in
// June the system learns of a move to Berlin in March, so the open Paris row
// is replaced by a closed copy and Berlin starts.
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { SimClock } from '../config/clock.js';
import { UNKNOWN_START } from '../db/client.js';
import { insertFact } from '../db/facts.js';
import type { NamespaceWithSelf } from '../db/namespaces.js';
import { testDb, withTestNamespace } from '../testing/db.js';
import { factsAsOf } from './asOf.js';

const db = testDb();
afterAll(async () => {
  await db.end();
});

const at = (iso: string) => new Date(`${iso}T00:00:00Z`);
const JAN = at('2024-01-15');
const MAR = at('2024-03-01');
const JUN = at('2024-06-10');

async function seed({ namespace, selfEntity }: NamespaceWithSelf) {
  const base = { namespaceId: namespace.id, subjectId: selfEntity.id, predicate: 'lives_in' };
  const original = randomUUID();
  const berlin = randomUUID();
  await insertFact(db, {
    ...base,
    id: original,
    objectLiteral: 'Paris',
    statement: 'Paris (original, open)',
    validFrom: JAN,
    recordedAt: JAN,
    invalidatedAt: JUN,
    status: 'revised',
  });
  await insertFact(db, {
    ...base,
    id: berlin,
    objectLiteral: 'Berlin',
    statement: 'Berlin',
    validFrom: MAR,
    recordedAt: JUN,
  });
  await insertFact(db, {
    ...base,
    objectLiteral: 'Paris',
    statement: 'Paris (closed copy)',
    validFrom: JAN,
    validTo: MAR,
    recordedAt: JUN,
    revises: original,
    supersededBy: berlin,
    status: 'superseded',
  });
  await insertFact(db, {
    ...base,
    objectLiteral: 'Marseille',
    statement: 'Marseille (unknown start)',
    validFrom: UNKNOWN_START,
    validFromSource: 'unknown',
    validTo: at('2015-01-01'),
    recordedAt: JUN,
  });
}

async function believed(
  ns: NamespaceWithSelf,
  q: { validAt?: Date; knownAt?: Date },
  now = '2024-09-01',
) {
  const facts = await factsAsOf(db, { namespaceId: ns.namespace.id, ...q }, new SimClock(at(now)));
  return facts.map((f) => f.statement);
}

describe('factsAsOf', () => {
  it('defaults both times to now: the current belief about the present', async () => {
    await withTestNamespace(db, async (ns) => {
      await seed(ns);
      expect(await believed(ns, {})).toEqual(['Berlin']);
    });
  });

  it('answers "where did they live in February" from the closed copy', async () => {
    await withTestNamespace(db, async (ns) => {
      await seed(ns);
      expect(await believed(ns, { validAt: at('2024-02-01') })).toEqual(['Paris (closed copy)']);
    });
  });

  it('answers "what did we believe in May" with the original, open Paris', async () => {
    await withTestNamespace(db, async (ns) => {
      await seed(ns);
      expect(await believed(ns, { knownAt: at('2024-05-01') })).toEqual(['Paris (original, open)']);
    });
  });

  it('switches beliefs exactly at the shared timestamp, with no gap or overlap', async () => {
    await withTestNamespace(db, async (ns) => {
      await seed(ns);
      const feb = at('2024-02-01');
      const before = new Date(JUN.getTime() - 1);
      const after = new Date(JUN.getTime() + 1);
      expect(await believed(ns, { validAt: feb, knownAt: before })).toEqual([
        'Paris (original, open)',
      ]);
      expect(await believed(ns, { validAt: feb, knownAt: JUN })).toEqual(['Paris (closed copy)']);
      expect(await believed(ns, { validAt: feb, knownAt: after })).toEqual(['Paris (closed copy)']);
    });
  });

  it('knows nothing before anything was recorded', async () => {
    await withTestNamespace(db, async (ns) => {
      await seed(ns);
      expect(await believed(ns, { knownAt: at('2024-01-01') })).toEqual([]);
    });
  });

  it('places an unknown start before every instant', async () => {
    await withTestNamespace(db, async (ns) => {
      await seed(ns);
      expect(await believed(ns, { validAt: at('1950-01-01') })).toEqual([
        'Marseille (unknown start)',
      ]);
      expect(await believed(ns, { validAt: at('2015-01-01') })).toEqual([]);
    });
  });

  it('excludes the archived tier unless asked', async () => {
    await withTestNamespace(db, async (ns) => {
      await seed(ns);
      await db`update facts set tier = 'archived' where namespace_id = ${ns.namespace.id} and statement = 'Berlin'`;
      expect(await believed(ns, {})).toEqual([]);
      const all = await factsAsOf(
        db,
        { namespaceId: ns.namespace.id, includeArchived: true },
        new SimClock(at('2024-09-01')),
      );
      expect(all.map((f) => f.statement)).toEqual(['Berlin']);
    });
  });

  it('filters by subject and predicate', async () => {
    await withTestNamespace(db, async (ns) => {
      await seed(ns);
      const q = { namespaceId: ns.namespace.id, subjectId: ns.selfEntity.id };
      const clock = new SimClock(at('2024-09-01'));
      expect(await factsAsOf(db, { ...q, predicate: 'works_at' }, clock)).toEqual([]);
      expect(await factsAsOf(db, { ...q, predicate: 'lives_in' }, clock)).toHaveLength(1);
    });
  });
});
