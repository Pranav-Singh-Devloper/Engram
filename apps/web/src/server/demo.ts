// POST /api/demo/session (SPEC §11, P09a decision 3): a 24-hour demo
// namespace behind an httpOnly cookie. The cookie holds a random secret; the
// namespace slug is its hash, so the database never holds the secret.
import { randomBytes } from 'node:crypto';
import { ensureNamespace } from '@engram/core';
import type { Clock, Sql } from '@engram/core';
import { DEMO_COOKIE, demoAccess, demoSlug } from './auth';
import type { WebConfig } from './config';
import { throttleSession } from './limits';

export const DEMO_TTL_MS = 24 * 3_600_000;

export async function createDemoSession(
  db: Sql,
  config: WebConfig,
  clock: Clock,
  req: Request,
): Promise<Response> {
  const now = clock.now();
  // A live session is returned as is, and asking again isn't throttled.
  const existing = await demoAccess(db, req, now);
  if (!(existing instanceof Response)) {
    const [ns] = await db<{ expiresAt: Date }[]>`
      select expires_at from namespaces where id = ${existing.namespaceId}`;
    return Response.json({ expiresAt: ns?.expiresAt ?? null, created: false });
  }
  const refused = await throttleSession(db, config.ipHashSecret, req, now);
  if (refused) return refused;

  const secret = randomBytes(16).toString('base64url');
  const expiresAt = new Date(now.getTime() + DEMO_TTL_MS);
  await ensureNamespace(db, { slug: demoSlug(secret), kind: 'demo', expiresAt });
  const cookie = [
    `${DEMO_COOKIE}=${secret}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${String(DEMO_TTL_MS / 1000)}`,
    ...(config.secureCookies ? ['Secure'] : []),
  ].join('; ');
  return Response.json(
    { expiresAt, created: true },
    { status: 201, headers: { 'set-cookie': cookie } },
  );
}
