import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { testDb, withTestNamespace } from '../testing/db.js';
import { bumpNamespaceRate, bumpThrottle, pruneThrottles, windowStart } from './throttles.js';

const db = testDb();
afterAll(async () => {
  await db.end();
});

describe('throttles', () => {
  it('aligns windows to the UTC hour and day', () => {
    const now = new Date('2026-10-19T11:42:07.123Z');
    expect(windowStart(now, 'hour').toISOString()).toBe('2026-10-19T11:00:00.000Z');
    expect(windowStart(now, 'day').toISOString()).toBe('2026-10-19T00:00:00.000Z');
  });

  it('counts concurrent bumps without losing any', async () => {
    const key = randomUUID();
    const w = new Date('2026-10-19T11:00:00Z');
    const counts = await Promise.all(
      Array.from({ length: 20 }, () => bumpThrottle(db, 'test', key, w)),
    );
    expect(counts.sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(await bumpThrottle(db, 'test', key, new Date('2026-10-19T12:00:00Z'))).toBe(1);
    await db`delete from throttles where key = ${key}`;
  });

  it('counts per namespace in rate_limits, and prunes old windows', async () => {
    await withTestNamespace(db, async (ns) => {
      const old = new Date('2026-10-10T00:00:00Z');
      expect(await bumpNamespaceRate(db, ns.namespace.id, old)).toBe(1);
      expect(await bumpNamespaceRate(db, ns.namespace.id, old)).toBe(2);
      const key = randomUUID();
      await bumpThrottle(db, 'test', key, old);
      await bumpThrottle(db, 'test', key, new Date('2026-10-19T00:00:00Z'));
      await pruneThrottles(db, new Date('2026-10-19T12:00:00Z'));
      const [r] = await db<{ n: number }[]>`
        select count(*)::int as n from rate_limits where namespace_id = ${ns.namespace.id}`;
      const [t] = await db<
        { n: number }[]
      >`select count(*)::int as n from throttles where key = ${key}`;
      expect([r?.n, t?.n]).toEqual([0, 1]);
      await db`delete from throttles where key = ${key}`;
    });
  });
});
