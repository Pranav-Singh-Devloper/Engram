// The timeline's "believed at" and "true at" rules are the engine's: replay the
// bitemporal story through core and compare with factsAsOf at many moments.
import { SimClock, ensureNamespace, factsAsOf } from '@engram/core';
import { Scenario, aboutSelf, hint, testDb } from '@engram/core/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_TOKEN, testRoutes } from '../server/testing';
import { Timeline } from './api';
import type { TimelineEntry } from './api';
import { believedAt, layoutTimeline, revisionChain, timeDomain, trueAt } from './timeline';

const db = testDb();
const t = testRoutes(db);
let entries: TimelineEntry[] = [];
let ns: Awaited<ReturnType<typeof ensureNamespace>>;

beforeAll(async () => {
  ns = await ensureNamespace(db, { slug: t.tokenSlug });
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
    at: '2024-08-01T09:00:00Z',
    content: 'Before Paris I lived in Lyon, 2015 to 2018.',
    candidates: [aboutSelf('lives_in', 'Lyon', { from: hint.year(2015), to: hint.year(2018) })],
  });
  await s.tell({
    at: '2024-08-01T09:05:00Z',
    content: 'And before that, Marseille.',
    candidates: [aboutSelf('lives_in', 'Marseille', { to: hint.year(2015) })],
  });
  const res = await t.routes.timeline(
    new Request('http://x?includeRevised=true', {
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    }),
    ns.selfEntity.id,
  );
  entries = Timeline.parse(await res.json()).entries;
});
afterAll(async () => {
  await db`delete from namespaces where slug = ${t.tokenSlug}`;
  await db.end();
});

describe('timeline rules match the engine', () => {
  const moments = ['2016-06-01', '2024-02-01', '2024-05-01', '2024-07-01', '2024-09-01'].map(
    (d) => new Date(`${d}T00:00:00Z`),
  );
  const knowns = ['2024-01-20', '2024-07-01', '2024-08-01T09:02:00', '2024-09-01'].map(
    (d) => new Date(d.includes('T') ? `${d}Z` : `${d}T00:00:00Z`),
  );

  it('selects the same versions as factsAsOf for every (validAt, knownAt) pair', async () => {
    for (const knownAt of knowns) {
      for (const validAt of moments) {
        const engine = await factsAsOf(
          db,
          {
            namespaceId: ns.namespace.id,
            subjectId: ns.selfEntity.id,
            predicate: 'lives_in',
            validAt,
            knownAt,
          },
          new SimClock('2024-09-01T00:00:00Z'),
        );
        const ui = entries.filter((e) => believedAt(e.fact, knownAt) && trueAt(e.fact, validAt));
        expect(
          ui.map((e) => e.fact.id).sort(),
          `${validAt.toISOString()} / ${knownAt.toISOString()}`,
        ).toEqual(engine.map((f) => f.id).sort());
      }
    }
  });
});

describe('layout', () => {
  it('clamps unknown starts and open ends to the axis, and stacks overlapping versions', () => {
    const now = new Date('2024-09-01T00:00:00Z');
    const { domain, lanes } = layoutTimeline(entries, now);
    const lane = lanes.find((l) => l.predicate === 'lives_in');
    expect(lane).toBeDefined();
    const marseille = lane?.bars.find((b) => b.label === 'Marseille');
    expect(marseille?.unknownStart).toBe(true);
    expect(marseille?.start).toEqual(domain[0]);
    const berlin = lane?.bars.find((b) => b.label === 'Berlin');
    expect(berlin?.open).toBe(true);
    expect(berlin?.end).toEqual(domain[1]);
    // The replaced open-ended Paris overlaps its closed copy: a second row.
    expect(lane?.rows).toBeGreaterThan(1);
    // The axis starts before the earliest known start (Lyon, 2015).
    expect(domain[0].getTime()).toBeLessThan(new Date('2015-01-01T00:00:00Z').getTime());
  });

  it('zooms to recent years, and keeps room for unknown starts', () => {
    const now = new Date('2024-09-01T00:00:00Z');
    const all = layoutTimeline(entries, now);
    const marseille = all.lanes[0]?.bars.find((b) => b.label === 'Marseille');
    const width = (marseille?.end.getTime() ?? 0) - (marseille?.start.getTime() ?? 0);
    const span = all.domain[1].getTime() - all.domain[0].getTime();
    expect(width / span).toBeGreaterThan(0.1);
    const year = layoutTimeline(entries, now, '1y');
    expect(year.domain[1].getTime() - year.domain[0].getTime()).toBeLessThanOrEqual(
      366 * 86_400_000,
    );
    // Lyon (2015–2018) ends before the 1-year window: it's off-axis to the left.
    const lyon = year.lanes[0]?.bars.find((b) => b.label === 'Lyon');
    expect(lyon && lyon.end < year.domain[0]).toBe(true);
  });

  it('walks a revision chain back through revises pointers', () => {
    const { lanes } = layoutTimeline(entries, new Date('2024-09-01T00:00:00Z'));
    const bars = lanes.flatMap((l) => l.bars);
    const closed = bars.find((b) => b.label === 'Paris' && b.revises !== null);
    expect(closed).toBeDefined();
    const chain = revisionChain(bars, closed?.id ?? '');
    expect(chain.map((b) => b.label)).toEqual(['Paris', 'Paris']);
    expect(chain[1]?.replaced).toBe(true);
  });

  it('pads a short history to a year-long axis', () => {
    const one = entries.slice(0, 1).map((e) => ({
      ...e,
      fact: {
        ...e.fact,
        validFrom: new Date('2024-08-30T00:00:00Z'),
        recordedAt: new Date('2024-08-30T00:00:00Z'),
        validTo: null,
      },
    }));
    const [lo, hi] = timeDomain(one, new Date('2024-09-01T00:00:00Z'));
    expect(hi.getTime() - lo.getTime()).toBeGreaterThan(360 * 86_400_000);
  });
});
