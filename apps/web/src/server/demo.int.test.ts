import { getNamespaceBySlug } from '@engram/core';
import { testDb } from '@engram/core/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { DEMO_COOKIE, demoSlug } from './auth';
import { LIMITS } from './limits';
import { cookieFrom, testRoutes } from './testing';

const db = testDb();
afterAll(async () => {
  await db`delete from namespaces where kind = 'demo' and slug like 'demo-%' and created_at > now() - interval '1 hour' and expires_at = '2026-10-20T12:00:00Z'`;
  await db.end();
});

const post = (headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/demo/session', {
    method: 'POST',
    headers: { 'x-real-ip': '198.51.100.9', ...headers },
  });

describe('POST /api/demo/session', () => {
  it('creates a 24-hour demo namespace behind an httpOnly, Secure, SameSite=Lax cookie', async () => {
    const { routes } = testRoutes(db);
    const res = await routes.demoSession(post());
    expect(res.status).toBe(201);
    const header = res.headers.get('set-cookie') ?? '';
    expect(header).toMatch(/HttpOnly/);
    expect(header).toMatch(/Secure/);
    expect(header).toMatch(/SameSite=Lax/);
    expect(header).toMatch(/Max-Age=86400/);
    const secret = cookieFrom(res).slice(DEMO_COOKIE.length + 1);
    const ns = await getNamespaceBySlug(db, demoSlug(secret));
    expect(ns).toMatchObject({ kind: 'demo' });
    expect(ns?.expiresAt?.toISOString()).toBe('2026-10-20T12:00:00.000Z');
    // The database never holds the cookie's secret.
    expect(ns?.slug).not.toContain(secret);
  });

  it('returns the live session instead of minting another, without throttling', async () => {
    const { routes } = testRoutes(db);
    const first = await routes.demoSession(post());
    for (let i = 0; i < LIMITS.sessionsPerIpHour + 2; i++) {
      const again = await routes.demoSession(post({ cookie: cookieFrom(first) }));
      expect(again.status).toBe(200);
      expect(again.headers.get('set-cookie')).toBeNull();
    }
  });

  it('throttles new sessions per IP', async () => {
    const { routes } = testRoutes(db);
    const statuses: number[] = [];
    for (let i = 0; i <= LIMITS.sessionsPerIpHour; i++) {
      statuses.push((await routes.demoSession(post({ 'x-real-ip': '203.0.113.50' }))).status);
    }
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it('drops Secure on plain-http local development', async () => {
    const { routes } = testRoutes(db, { secureCookies: false });
    const res = await routes.demoSession(post({ 'x-real-ip': '198.51.100.77' }));
    expect(res.headers.get('set-cookie')).not.toMatch(/Secure/);
  });
});
