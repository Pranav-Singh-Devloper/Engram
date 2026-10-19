import { randomUUID } from 'node:crypto';
import { ensureNamespace } from '@engram/core';
import { testDb } from '@engram/core/testing';
import { tokenResolver } from '@engram/mcp';
import { afterAll, describe, expect, it } from 'vitest';
import { DEMO_COOKIE, bearerToken, demoAccess, demoSlug, readAccess, tokenAccess } from './auth';
import type { Access, AuthConfig } from './auth';

const db = testDb();
const created: string[] = [];
afterAll(async () => {
  await db`delete from namespaces where slug = any(${created})`;
  await db.end();
});

const TOKEN = 'a'.repeat(32);
const tokenSlug = `test-token-${randomUUID()}`;
const showcaseSlug = `test-showcase-${randomUUID()}`;
created.push(tokenSlug, showcaseSlug);
const cfg: AuthConfig = {
  resolveToken: tokenResolver(new Map([[TOKEN, tokenSlug]])),
  showcaseSlug,
};
const NOW = new Date('2026-10-19T12:00:00Z');

const req = (headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/x', { headers });

async function demo(expiresAt: Date) {
  const secret = randomUUID();
  const slug = demoSlug(secret);
  created.push(slug);
  const { namespace } = await ensureNamespace(db, { slug, kind: 'demo', expiresAt });
  return { secret, namespace };
}

const status = (a: Access | Response) => (a instanceof Response ? a.status : a.kind);

describe('bearer tokens', () => {
  it('parses the header, and marks a malformed one', () => {
    expect(bearerToken(req())).toBeUndefined();
    expect(bearerToken(req({ authorization: `Bearer ${TOKEN}` }))).toBe(TOKEN);
    expect(bearerToken(req({ authorization: 'Basic x' }))).toBe('');
  });

  it('resolves a known token to its namespace and refuses the rest', async () => {
    const ok = await tokenAccess(db, cfg, req({ authorization: `Bearer ${TOKEN}` }));
    expect(ok).toMatchObject({ kind: 'token', writable: true });
    const cases: Record<string, string>[] = [
      {},
      { authorization: 'Bearer nope' },
      { authorization: 'Token x' },
    ];
    for (const h of cases) {
      expect(status(await tokenAccess(db, cfg, req(h)))).toBe(401);
    }
  });

  it("never accepts the demo cookie in a token's place", async () => {
    const { secret } = await demo(new Date(NOW.getTime() + 3600_000));
    expect(status(await tokenAccess(db, cfg, req({ cookie: `${DEMO_COOKIE}=${secret}` })))).toBe(
      401,
    );
  });
});

describe('demo cookie', () => {
  it('maps a live cookie to its demo namespace, never storing the secret', async () => {
    const { secret, namespace } = await demo(new Date(NOW.getTime() + 3600_000));
    const a = await demoAccess(db, req({ cookie: `other=1; ${DEMO_COOKIE}=${secret}` }), NOW);
    expect(a).toEqual({ kind: 'demo', namespaceId: namespace.id, writable: true });
    expect(namespace.slug).not.toContain(secret);
  });

  it('refuses a missing, unknown or expired cookie, and a bearer token', async () => {
    const { secret } = await demo(new Date(NOW.getTime() - 1));
    const cases: Record<string, string>[] = [
      {},
      { cookie: `${DEMO_COOKIE}=${randomUUID()}` },
      { cookie: `${DEMO_COOKIE}=${secret}` },
      { authorization: `Bearer ${TOKEN}` },
    ];
    for (const h of cases) {
      expect(status(await demoAccess(db, req(h), NOW))).toBe(401);
    }
  });
});

describe('read access', () => {
  it('prefers a token, then a live cookie, then the read-only showcase', async () => {
    await ensureNamespace(db, { slug: showcaseSlug });
    const live = await demo(new Date(NOW.getTime() + 3600_000));
    const gone = await demo(new Date(NOW.getTime() - 1));
    expect(status(await readAccess(db, cfg, req({ authorization: `Bearer ${TOKEN}` }), NOW))).toBe(
      'token',
    );
    expect(
      status(await readAccess(db, cfg, req({ cookie: `${DEMO_COOKIE}=${live.secret}` }), NOW)),
    ).toBe('demo');
    // An expired session falls back to the showcase rather than failing.
    const fallback = await readAccess(
      db,
      cfg,
      req({ cookie: `${DEMO_COOKIE}=${gone.secret}` }),
      NOW,
    );
    expect(fallback).toMatchObject({ kind: 'showcase', writable: false });
    expect(status(await readAccess(db, cfg, req(), NOW))).toBe('showcase');
  });

  it('treats a bad token as 401, never as a silent showcase visit', async () => {
    expect(status(await readAccess(db, cfg, req({ authorization: 'Bearer nope' }), NOW))).toBe(401);
  });

  it('is 401 when no showcase is configured and no credentials are given', async () => {
    const none = { ...cfg, showcaseSlug: undefined };
    expect(status(await readAccess(db, none, req(), NOW))).toBe(401);
  });
});
