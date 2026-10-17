// The decay sweep on a simulated clock (SPEC §9.1-9.2), compared with the TS
// mirror of the score.
import { afterAll, describe, expect, it } from 'vitest';
import { getFact, insertFact } from '../db/facts.js';
import type { NewFact } from '../db/facts.js';
import { listFactRevisions } from '../db/factRevisions.js';
import type { NamespaceWithSelf } from '../db/namespaces.js';
import { testDb, withTestNamespace } from '../testing/db.js';
import { retentionScore } from './score.js';
import { decaySweep, lastSweep } from './sweep.js';

const db = testDb();
afterAll(async () => {
  await db.end();
});

const DAY = 86_400_000;
const t0 = new Date('2024-01-01T00:00:00Z');
const at = (days: number) => new Date(t0.getTime() + days * DAY);

function factFor(
  ns: NamespaceWithSelf,
  over: Partial<NewFact> = {},
): Promise<Awaited<ReturnType<typeof insertFact>>> {
  return insertFact(db, {
    namespaceId: ns.namespace.id,
    subjectId: ns.selfEntity.id,
    predicate: 'likes',
    objectLiteral: `thing ${Math.random()}`,
    statement: 'The user likes a thing.',
    validFrom: t0,
    recordedAt: t0,
    importance: 0.5,
    ...over,
  });
}

const sweep = (ns: NamespaceWithSelf, days: number) =>
  decaySweep(db, { now: at(days), namespaceId: ns.namespace.id });
const tier = async (id: string) => (await getFact(db, id))?.tier;

describe('decay sweep', () => {
  it('archives a default-importance working fact between day 41.5 and 42.5 (~3τ)', async () => {
    await withTestNamespace(db, async (ns) => {
      const f = await factFor(ns);
      expect(await sweep(ns, 41.5)).toEqual({ archived: 0 });
      expect(await tier(f.id)).toBe('working');
      expect(await sweep(ns, 42.5)).toEqual({ archived: 1 });
      expect(await tier(f.id)).toBe('archived');
    });
  });

  it('gives long-term facts ~270 days, and never moves working ↔ long_term', async () => {
    await withTestNamespace(db, async (ns) => {
      const lt = await factFor(ns, { tier: 'long_term' });
      const w = await factFor(ns, { importance: 0.9 });
      await sweep(ns, 269);
      expect(await tier(lt.id)).toBe('long_term');
      expect(await tier(w.id)).toBe('working');
      await sweep(ns, 270.5);
      expect(await tier(lt.id)).toBe('archived');
    });
  });

  it('archives by decay iff importance < 0.6 (the §9.1 invariant)', async () => {
    await withTestNamespace(db, async (ns) => {
      const [low, edge, high] = [
        await factFor(ns, { importance: 0.55 }),
        await factFor(ns, { importance: 0.6 }),
        await factFor(ns, { importance: 0.65 }),
      ];
      await sweep(ns, 10_000);
      expect([await tier(low.id), await tier(edge.id), await tier(high.id)]).toEqual([
        'archived',
        'working',
        'working',
      ]);
    });
  });

  it("exempts pinned facts, static predicates and the user's name", async () => {
    await withTestNamespace(db, async (ns) => {
      const pinned = await factFor(ns, { pinned: true, importance: 0.1 });
      const born = await factFor(ns, { predicate: 'birth_date', importance: 0.1 });
      const named = await factFor(ns, {
        predicate: 'is_named',
        objectLiteral: 'Priya',
        importance: 0.1,
      });
      const plain = await factFor(ns, { importance: 0.1 });
      await sweep(ns, 10_000);
      expect([
        await tier(pinned.id),
        await tier(born.id),
        await tier(named.id),
        await tier(plain.id),
      ]).toEqual(['working', 'working', 'working', 'archived']);
    });
  });

  it('only scores current beliefs: replaced versions are left alone', async () => {
    await withTestNamespace(db, async (ns) => {
      const old = await factFor(ns, { importance: 0.1, invalidatedAt: at(1), status: 'revised' });
      await sweep(ns, 10_000);
      expect(await tier(old.id)).toBe('working');
    });
  });

  it('logs one archive revision per archived fact, at the sweep time, and records the sweep', async () => {
    await withTestNamespace(db, async (ns) => {
      await factFor(ns);
      await factFor(ns);
      await sweep(ns, 100);
      const revisions = await listFactRevisions(db, ns.namespace.id);
      expect(revisions.map((r) => [r.kind, r.resolver, r.createdAt.getTime()])).toEqual([
        ['archive', 'decay', at(100).getTime()],
        ['archive', 'decay', at(100).getTime()],
      ]);
      expect(await lastSweep(db, ns.namespace.id)).toEqual(at(100));
      await sweep(ns, 200);
      expect(await listFactRevisions(db, ns.namespace.id)).toHaveLength(2);
    });
  });

  it('decays access_score by exp(−Δt/τ) between sweeps, and accesses delay archiving', async () => {
    await withTestNamespace(db, async (ns) => {
      const used = await factFor(ns, { accessScore: 10, lastAccessedAt: at(0) });
      const idle = await factFor(ns);
      await sweep(ns, 0);
      await sweep(ns, 14);
      expect((await getFact(db, used.id))?.accessScore).toBeCloseTo(10 * Math.exp(-1), 4);
      await sweep(ns, 43);
      expect(await tier(idle.id)).toBe('archived');
      expect(await tier(used.id)).toBe('working');
    });
  });

  it('matches the TS mirror of the score', async () => {
    await withTestNamespace(db, async (ns) => {
      const cases = [
        { importance: 0.3, accessScore: 3, lastAccessedAt: at(5) },
        { importance: 0.8, accessScore: 0, lastAccessedAt: null },
        { importance: 0.5, accessScore: 25, lastAccessedAt: at(20), tier: 'long_term' as const },
      ];
      for (const c of cases) {
        const f = await factFor(ns, c);
        const [row] = await db<{ score: number }[]>`
          select 0.5 * exp(-greatest(0, extract(epoch from (${at(60)}::timestamptz - coalesce(last_accessed_at, recorded_at))) / 86400.0)
                   / case when tier = 'long_term' then 90 else 14 end)
               + 0.25 * least(1, ln(1 + access_score) / ln(21)) + 0.25 * importance as score
          from facts where id = ${f.id}`;
        const mirror = retentionScore({ ...c, tier: c.tier ?? 'working', recordedAt: t0 }, at(60));
        expect(row?.score).toBeCloseTo(mirror, 5);
      }
    });
  });

  it('sweeps only the namespace asked for', async () => {
    // A sweep with no namespace covers all of them (pg_cron); tests share a
    // database, so they only ever sweep their own.
    await withTestNamespace(db, async (a) => {
      await withTestNamespace(db, async (b) => {
        const fa = await factFor(a);
        const fb = await factFor(b);
        await sweep(a, 100);
        expect([await tier(fa.id), await tier(fb.id)]).toEqual(['archived', 'working']);
      });
    });
  });
});
