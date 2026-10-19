import { randomUUID } from 'node:crypto';
import { ensureNamespace, FakeProvider, getEpisode } from '@engram/core';
import { aboutSelf, testDb } from '@engram/core/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { DEMO_COOKIE } from './auth';
import { TEST_TOKEN, testRoutes } from './testing';

const db = testDb();
const slugs: string[] = [];
afterAll(async () => {
  await db`delete from namespaces where slug = any(${slugs}::text[])`;
  await db.end();
});

const LISBON = 'I live in Lisbon.';
function setup() {
  const provider = new FakeProvider().when('processEpisode', (i) => i.content === LISBON, {
    importance: 0.7,
    candidates: [aboutSelf('lives_in', 'Lisbon')],
  });
  const t = testRoutes(db, { showcaseSlug: `test-showcase-${randomUUID()}` }, provider);
  slugs.push(t.tokenSlug, t.config.showcaseSlug ?? '');
  return t;
}
const post = (
  p: string,
  body: unknown,
  headers: Record<string, string> = { authorization: `Bearer ${TEST_TOKEN}` },
) =>
  new Request(`http://localhost${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('POST /api/remember', () => {
  it('stores at once and extracts only after the response is sent', async () => {
    const t = setup();
    const res = await t.routes.remember(post('/api/remember', { content: LISBON }));
    expect(res.status).toBe(202);
    const { episode_id, status, session_id } = (await res.json()) as Record<string, string>;
    expect([status, session_id]).toEqual(['pending', 'api-2026-10-19']);
    expect((await getEpisode(db, episode_id ?? ''))?.processedAt).toBeNull();
    await t.runDeferred();
    expect((await getEpisode(db, episode_id ?? ''))?.processedAt).not.toBeNull();
    const [fact] = await db<{ statement: string }[]>`
      select statement from facts f join namespaces n on n.id = f.namespace_id where n.slug = ${t.tokenSlug}`;
    expect(fact?.statement).toBe('The user lives in Lisbon.');
  });

  it('waits for extraction when asked', async () => {
    const t = setup();
    const res = await t.routes.remember(post('/api/remember', { content: LISBON, wait: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: 'processed',
      extracted: 1,
      outcomes: { inserted: 1 },
    });
  });

  it('needs a bearer token: no credentials, a demo cookie or the showcase never write', async () => {
    const t = setup();
    await ensureNamespace(db, { slug: t.config.showcaseSlug ?? '' });
    const cases: Record<string, string>[] = [
      {},
      { cookie: `${DEMO_COOKIE}=x` },
      { authorization: 'Bearer wrong' },
    ];
    for (const headers of cases) {
      expect(
        (await t.routes.remember(post('/api/remember', { content: LISBON }, headers))).status,
      ).toBe(401);
    }
  });

  it('rejects a bad body', async () => {
    const t = setup();
    expect((await t.routes.remember(post('/api/remember', 'not json'))).status).toBe(400);
    expect((await t.routes.remember(post('/api/remember', { content: '' }))).status).toBe(400);
    expect(
      (await t.routes.remember(post('/api/remember', { content: 'x'.repeat(8001) }))).status,
    ).toBe(400);
  });
});

describe('POST /api/recall', () => {
  it("returns the token namespace's memories and records their use", async () => {
    const t = setup();
    await t.routes.remember(post('/api/remember', { content: LISBON, wait: true }));
    const res = await t.routes.recall(post('/api/recall', { query: 'The user lives in Lisbon.' }));
    const body = (await res.json()) as {
      abstained: boolean;
      memories: { kind: string; text: string }[];
    };
    expect(body.abstained).toBe(false);
    expect(body.memories.find((m) => m.kind === 'fact')?.text).toBe('The user lives in Lisbon.');
    const [row] = await db<{ accessScore: number }[]>`
      select f.access_score from facts f join namespaces n on n.id = f.namespace_id where n.slug = ${t.tokenSlug}`;
    expect(row?.accessScore).toBeGreaterThan(0);
  });

  it('needs a bearer token', async () => {
    const t = setup();
    expect((await t.routes.recall(post('/api/recall', { query: 'x' }, {}))).status).toBe(401);
  });
});
