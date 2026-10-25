import { randomUUID } from 'node:crypto';
import {
  FakeProvider,
  bumpNamespaceRate,
  ensureNamespace,
  getNamespaceBySlug,
  windowStart,
} from '@engram/core';
import { aboutSelf, testDb } from '@engram/core/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { DEMO_COOKIE, demoSlug } from './auth';
import { CAP_MESSAGE, NOTED } from './chat';
import { LIMITS } from './limits';
import { readEvents } from './sse';
import { TEST_TOKEN, cookieFrom, testRoutes } from './testing';

const db = testDb();
const namespaces: string[] = [];
afterAll(async () => {
  await db`delete from namespaces where id = any(${namespaces}::uuid[])`;
  await db.end();
});

const LISBON = 'I live in Lisbon.';
const ACME = 'I work at Acme.';
function provider() {
  return new FakeProvider()
    .when('processEpisode', (i) => i.content === LISBON, {
      importance: 0.7,
      candidates: [aboutSelf('lives_in', 'Lisbon')],
    })
    .when('processEpisode', (i) => i.content === ACME, {
      importance: 0.6,
      candidates: [aboutSelf('works_at', 'Acme', { type: 'org' })],
    })
    .when('processEpisode', () => true, { importance: 0.2, candidates: [] })
    .when(
      'compose',
      () => true,
      (input) => ({
        answer: 'You live in Lisbon.',
        supported: true,
        usedMemoryIds: input.memories.filter((m) => m.text.includes('Lisbon')).map((m) => m.id),
      }),
    );
}

/** A visitor: their own demo session (cookie) on fresh routes. */
async function visitor(overrides: Parameters<typeof testRoutes>[1] = {}, fake = provider()) {
  const t = testRoutes(db, overrides, fake);
  const ip = `10.9.${String(Math.floor(Math.random() * 250))}.${String(Math.floor(Math.random() * 250))}`;
  const res = await t.routes.demoSession(
    new Request('http://x/api/demo/session', { method: 'POST', headers: { 'x-real-ip': ip } }),
  );
  const cookie = cookieFrom(res);
  const ns = await getNamespaceBySlug(db, demoSlug(cookie.slice(DEMO_COOKIE.length + 1)));
  namespaces.push(ns?.id ?? '');
  const say = (message: string, session_id = 'a', headers: Record<string, string> = { cookie }) =>
    t.routes.chat(
      new Request('http://x/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ message, session_id }),
      }),
    );
  return { ...t, cookie, namespaceId: ns?.id ?? '', say };
}

describe('POST /api/chat', () => {
  it('streams memories, then the answer, then done; extraction waits until after the response', async () => {
    const v = await visitor();
    const events = await readEvents(await v.say(LISBON));
    expect(events.map((e) => e.event)).toEqual(['memories', 'answer', 'done']);
    const [unprocessed] = await db<{ n: number }[]>`
      select count(*)::int as n from episodes where namespace_id = ${v.namespaceId} and processed_at is null`;
    expect(unprocessed?.n).toBe(2); // the visitor's turn and the reply
    await v.runDeferred();
    const facts = await db<
      { statement: string }[]
    >`select statement from facts where namespace_id = ${v.namespaceId}`;
    expect(facts.map((f) => f.statement)).toEqual(['The user lives in Lisbon.']);
  });

  it('recalls across sessions and records use only for the memories the composer used', async () => {
    const v = await visitor();
    await readEvents(await v.say(LISBON, 'a'));
    await readEvents(await v.say(ACME, 'a'));
    await v.runDeferred();
    const events = await readEvents(await v.say('The user lives in Lisbon.', 'b'));
    const answer = events.find((e) => e.event === 'answer')?.data as {
      text: string;
      used_memory_ids: string[];
    };
    expect(answer.text).toBe('You live in Lisbon.');
    expect(answer.used_memory_ids.length).toBeGreaterThan(0);
    const rows = await db<{ statement: string; accessScore: number }[]>`
      select statement, access_score from facts where namespace_id = ${v.namespaceId} order by statement`;
    expect(rows.map((r) => [r.statement, r.accessScore > 0])).toEqual([
      ['The user lives in Lisbon.', true],
      ['The user works at Acme.', false],
    ]);
  });

  it("stores the visitor's turn but not a reply no memory supported", async () => {
    // Seen in the first browser run: an "I don't know." reply was stored and
    // then came back as a recalled memory in the next session.
    const v = await visitor(
      {},
      new FakeProvider()
        .when('processEpisode', () => true, { importance: 0.2, candidates: [] })
        .when('compose', () => true, {
          answer: "I don't know.",
          supported: false,
          usedMemoryIds: [],
        }),
    );
    const events = await readEvents(await v.say('Hello there'));
    // A statement shows an acknowledgement; a question keeps the abstention.
    expect(events.find((e) => e.event === 'answer')?.data).toMatchObject({
      text: NOTED,
      supported: false,
    });
    expect((events.at(-1)?.data as { episode_ids: string[] }).episode_ids).toHaveLength(1);
    const asked = await readEvents(await v.say('Where do I live?'));
    expect(asked.find((e) => e.event === 'answer')?.data).toMatchObject({
      text: "I don't know.",
    });
    const rows = await db<
      { role: string }[]
    >`select role from episodes where namespace_id = ${v.namespaceId}`;
    expect(rows.map((r) => r.role)).toEqual(['user', 'user']);
  });

  it('refuses the 31st turn in an hour with 429, before any model call', async () => {
    const v = await visitor();
    const w = windowStart(v.clock.now(), 'hour');
    for (let i = 0; i < LIMITS.turnsPerNamespaceHour; i++)
      await bumpNamespaceRate(db, v.namespaceId, w);
    const res = await v.say(LISBON);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ limit: 'namespace' });
    expect(v.provider.callsTo('compose')).toHaveLength(0);
  });

  it('answers with the cap message at the global cap, while showcase reads keep working', async () => {
    const showcaseSlug = `test-showcase-${randomUUID()}`;
    const showcase = await ensureNamespace(db, { slug: showcaseSlug });
    namespaces.push(showcase.namespace.id);
    const v = await visitor({ dailyTurnCap: 0, showcaseSlug });
    const res = await v.say(LISBON);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: CAP_MESSAGE, limit: 'global' });
    expect((await v.routes.memories(new Request('http://x/api/memories'))).status).toBe(200);
  });

  it('works only on the cookie namespace', async () => {
    const a = await visitor();
    const b = await visitor();
    await readEvents(await a.say(LISBON, 'shared'));
    await readEvents(await b.say(ACME, 'shared'));
    const [inA] = await db<{ n: number }[]>`
      select count(*)::int as n from episodes where namespace_id = ${a.namespaceId}`;
    expect(inA?.n).toBe(2); // the same session id from another visitor never lands here
    expect((await a.say(LISBON, 'a', {})).status).toBe(401);
    expect((await a.say(LISBON, 'a', { authorization: `Bearer ${TEST_TOKEN}` })).status).toBe(401);
  });

  it('rejects a bad body', async () => {
    const v = await visitor();
    expect((await v.say('', 'a')).status).toBe(400);
    expect((await v.say('hi', 'not a valid id!')).status).toBe(400);
  });
});
