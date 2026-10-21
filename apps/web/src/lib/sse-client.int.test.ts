// streamChat end to end: the real chat route, a real demo session cookie.
import { FakeProvider } from '@engram/core';
import { testDb } from '@engram/core/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { DEMO_COOKIE, demoSlug } from '../server/auth';
import { cookieFrom, testRoutes } from '../server/testing';
import { streamChat } from './sse-client';
import type { ChatEvent } from './sse-client';

const db = testDb();
const slugs: string[] = [];
afterAll(async () => {
  await db`delete from namespaces where slug = any(${slugs}::text[])`;
  await db.end();
});

describe('streamChat against /api/chat', () => {
  it('streams a real turn from the route', async () => {
    const provider = new FakeProvider()
      .when('processEpisode', () => true, { importance: 0.3, candidates: [] })
      .when('compose', () => true, { answer: 'Hello!', supported: false, usedMemoryIds: [] });
    const t = testRoutes(db, {}, provider);
    const session = await t.routes.demoSession(
      new Request('http://x/api/demo/session', {
        method: 'POST',
        headers: { 'x-real-ip': '198.51.100.200' },
      }),
    );
    const cookie = cookieFrom(session);
    slugs.push(demoSlug(cookie.slice(DEMO_COOKIE.length + 1)));
    const fetchViaRoute = ((url: string, init: RequestInit) =>
      t.routes.chat(
        new Request(`http://x${url}`, {
          ...init,
          headers: { ...(init.headers as Record<string, string>), cookie },
        }),
      )) as unknown as typeof fetch;

    const events: ChatEvent[] = [];
    const outcome = await streamChat(
      { message: 'hi there', session_id: 's1' },
      (e) => events.push(e),
      {
        fetch: fetchViaRoute,
      },
    );
    expect(outcome).toEqual({ kind: 'done' });
    expect(events.map((e) => e.event)).toEqual(['memories', 'answer', 'done']);
    const answer = events.find((e) => e.event === 'answer');
    expect(answer?.event === 'answer' && answer.data.text).toBe('Hello!');
  });
});
