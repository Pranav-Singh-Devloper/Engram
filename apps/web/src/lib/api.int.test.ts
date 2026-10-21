// The client schemas parse what the real routes return: if the server's shape
// drifts, this fails rather than the UI quietly misrendering.
import { ensureNamespace } from '@engram/core';
import { Scenario, aboutSelf, hint, testDb } from '@engram/core/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { TEST_TOKEN, testRoutes } from '../server/testing';
import { Evals, MemoriesPage, Timeline, memoriesUrl } from './api';

const db = testDb();
const t = testRoutes(db, {
  reportsDir: new URL('../../../../bench/reports', import.meta.url).pathname,
});
afterAll(async () => {
  await db`delete from namespaces where slug = ${t.tokenSlug}`;
  await db.end();
});
const get = (p: string) =>
  new Request(`http://x${p}`, { headers: { authorization: `Bearer ${TEST_TOKEN}` } });

describe('client schemas against the real routes', () => {
  it('parse memories, a timeline with revised versions, and the bench runs', async () => {
    const ns = await ensureNamespace(db, { slug: t.tokenSlug });
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
    const page = MemoriesPage.parse(await (await t.routes.memories(get('/api/memories'))).json());
    expect(page.memories.length).toBe(2);
    expect(page.memories[0]?.validFrom).toBeInstanceOf(Date);

    const tl = Timeline.parse(
      await (await t.routes.timeline(get('/x?includeRevised=true'), ns.selfEntity.id)).json(),
    );
    expect(tl.entries).toHaveLength(3);
    expect(tl.entries.some((e) => e.fact.revises !== null)).toBe(true);

    const evals = Evals.parse(await t.routes.evals().json());
    expect(evals.runs.some((r) => r.runId === '2026-10-18-test')).toBe(true);
  });

  it('builds memory URLs without empty or false filters', () => {
    expect(memoriesUrl()).toBe('/api/memories');
    expect(memoriesUrl({ q: 'berlin', tier: 'working', all: false, status: '' })).toBe(
      '/api/memories?q=berlin&tier=working',
    );
  });
});
