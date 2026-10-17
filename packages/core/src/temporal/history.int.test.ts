import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { testDb, withTestNamespace } from '../testing/db.js';
import { Scenario, aboutSelf, hint } from '../testing/scenario.js';
import { history } from './history.js';

const db = testDb();
afterAll(async () => {
  await db.end();
});

async function movedThrice(s: Scenario) {
  await s.tell({
    at: '2024-01-15T09:00:00Z',
    content: 'I live in Paris.',
    candidates: [aboutSelf('lives_in', 'Paris')],
  });
  await s.tell({
    at: '2024-06-10T09:00:00Z',
    content: 'I moved to Berlin in March.',
    candidates: [aboutSelf('lives_in', 'Berlin', { from: hint.month(3) })],
  });
  await s.tell({
    at: '2024-08-01T09:00:00Z',
    content: 'I lived in Lyon from 2015 to 2018.',
    candidates: [aboutSelf('lives_in', 'Lyon', { from: hint.year(2015), to: hint.year(2018) })],
  });
  await s.tell({
    at: '2024-08-02T09:00:00Z',
    content: 'I work at Acme.',
    candidates: [aboutSelf('works_at', 'Acme', { type: 'org' })],
  });
}

describe('history', () => {
  it('orders the timeline by valid time and hides replaced versions by default', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await movedThrice(s);
      const timeline = await history(db, ns.namespace.id, ns.selfEntity.id, {
        predicate: 'lives_in',
      });
      expect(timeline.map((e) => [e.objectName, e.fact.status])).toEqual([
        ['Lyon', 'superseded'],
        ['Paris', 'superseded'],
        ['Berlin', 'active'],
      ]);
      expect(timeline.every((e) => !e.replaced)).toBe(true);
    });
  });

  it('adds the replaced versions, with their record windows, for the audit view', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await movedThrice(s);
      const audit = await history(db, ns.namespace.id, ns.selfEntity.id, {
        predicate: 'lives_in',
        includeRevised: true,
      });
      const paris = audit.filter((e) => e.objectName === 'Paris');
      expect(paris.map((e) => [e.replaced, e.fact.validTo?.toISOString() ?? null])).toEqual([
        [true, null],
        [false, '2024-03-01T00:00:00.000Z'],
      ]);
      expect(paris[0]?.fact.invalidatedAt).toEqual(paris[1]?.fact.recordedAt);
    });
  });

  it('covers every predicate unless one is given, and keeps retractions visible', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await movedThrice(s);
      await s.tell({
        at: '2024-08-03T09:00:00Z',
        content: 'Actually, I work at Initech, not Acme.',
        candidates: [aboutSelf('works_at', 'Initech', { type: 'org', correction: true })],
      });
      const all = await history(db, ns.namespace.id, ns.selfEntity.id);
      // Another namespace's id finds nothing, even for a real entity id.
      expect(await history(db, randomUUID(), ns.selfEntity.id)).toEqual([]);
      expect(new Set(all.map((e) => e.fact.predicate))).toEqual(new Set(['lives_in', 'works_at']));
      expect(
        all
          .filter((e) => e.fact.predicate === 'works_at')
          .map((e) => [e.objectName, e.fact.status]),
      ).toEqual([
        ['Acme', 'retracted'],
        ['Initech', 'active'],
      ]);
    });
  });
});
