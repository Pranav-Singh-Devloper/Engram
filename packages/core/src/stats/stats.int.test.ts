import { afterAll, describe, expect, it } from 'vitest';
import { insertEpisode } from '../db/episodes.js';
import { decaySweep } from '../decay/sweep.js';
import { testDb, withTestNamespace } from '../testing/db.js';
import { Scenario, aboutSelf, hint } from '../testing/scenario.js';
import { namespaceStats } from './stats.js';

const db = testDb();
afterAll(async () => {
  await db.end();
});

describe('namespaceStats', () => {
  it('counts current beliefs, episodes, entities, the ad-hoc rate and the last sweep', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
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
        at: '2024-06-11T09:00:00Z',
        content: 'I collect stamps.',
        candidates: [aboutSelf('collects', 'stamps', { type: 'concept' })],
      });
      await insertEpisode(db, {
        namespaceId: ns.namespace.id,
        sessionId: 's1',
        kind: 'summary',
        role: 'system',
        content: 'The user moved from Paris to Berlin.',
      });

      const before = await namespaceStats(db, ns.namespace.id);
      // Berlin (active), the closed Paris copy (superseded) and stamps; the
      // replaced Paris original isn't a current belief.
      expect(before.facts).toMatchObject({
        total: 3,
        byTier: { working: 3, long_term: 0, archived: 0 },
        byStatus: { active: 2, superseded: 1, retracted: 0, revised: 0 },
      });
      expect(before.facts.adHocRate).toBeCloseTo(1 / 3, 5);
      expect(before.episodes).toEqual({
        turns: 3,
        summaries: 1,
        unprocessed: 1,
        unconsolidated: 3,
      });
      expect(before.entities).toBe(3);
      // Global sweeps (other tests') count for every namespace, so only order is checked.
      const at = new Date('2998-01-01T00:00:00Z');
      expect(before.lastSweep === null || before.lastSweep < at).toBe(true);

      await decaySweep(db, { now: at, namespaceId: ns.namespace.id });
      expect((await namespaceStats(db, ns.namespace.id)).lastSweep).toEqual(at);
    });
  });
});
