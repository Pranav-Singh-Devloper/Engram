// Who a request acts as (P09a decision 5). Writes need a bearer token
// (ENGRAM_MCP_TOKENS, shared with /api/mcp; decision 1). The demo chat needs
// the demo cookie. Reads take a token, the cookie, or neither, and with
// neither they see the read-only showcase namespace.
import { createHash } from 'node:crypto';
import { ensureNamespace, getNamespaceBySlug } from '@engram/core';
import type { Sql } from '@engram/core';

export const DEMO_COOKIE = 'engram_demo';

export interface Access {
  kind: 'token' | 'demo' | 'showcase';
  namespaceId: string;
  /** False for the showcase: anonymous visitors only read it. */
  writable: boolean;
}

export interface AuthConfig {
  /** Bearer token → namespace slug, in constant time (`tokenResolver`). */
  resolveToken: (token: string) => string | undefined;
  /** ENGRAM_SHOWCASE_NAMESPACE: what anonymous reads see (seeded in P10). */
  showcaseSlug: string | undefined;
}

export const unauthorized = (message = 'Missing or invalid credentials.') =>
  Response.json({ error: message }, { status: 401 });

/** The bearer token, or undefined when there's no Authorization header. Malformed is ''. */
export function bearerToken(req: Request): string | undefined {
  const h = req.headers.get('authorization');
  if (h === null) return undefined;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(h);
  return m?.[1] ?? '';
}

export function cookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name)
      return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/**
 * A demo namespace's slug, derived from the cookie's secret. The database
 * holds only this hash, so reading it doesn't let anyone act as a visitor.
 */
export const demoSlug = (secret: string) =>
  `demo-${createHash('sha256').update(secret).digest('hex').slice(0, 32)}`;

/** Bearer-only endpoints: the token's namespace, or 401. */
export async function tokenAccess(
  db: Sql,
  cfg: AuthConfig,
  req: Request,
): Promise<Access | Response> {
  const token = bearerToken(req);
  const slug = token ? cfg.resolveToken(token) : undefined;
  if (!slug) return unauthorized();
  const { namespace } = await ensureNamespace(db, { slug, kind: 'user' });
  return { kind: 'token', namespaceId: namespace.id, writable: true };
}

/** Cookie-only endpoints (chat): a live demo namespace, or 401. */
export async function demoAccess(db: Sql, req: Request, now: Date): Promise<Access | Response> {
  const secret = cookie(req, DEMO_COOKIE);
  if (!secret) return unauthorized('No demo session. Start one with POST /api/demo/session.');
  const ns = await getNamespaceBySlug(db, demoSlug(secret));
  if (!ns || ns.kind !== 'demo' || (ns.expiresAt && ns.expiresAt <= now)) {
    return unauthorized('The demo session has expired. Start a new one.');
  }
  return { kind: 'demo', namespaceId: ns.id, writable: true };
}

/**
 * Read endpoints: a token (a bad one is 401, never a silent fallback), then a
 * live demo cookie, then the showcase.
 */
export async function readAccess(
  db: Sql,
  cfg: AuthConfig,
  req: Request,
  now: Date,
): Promise<Access | Response> {
  if (bearerToken(req) !== undefined) return tokenAccess(db, cfg, req);
  if (cookie(req, DEMO_COOKIE)) {
    const demo = await demoAccess(db, req, now);
    if (!(demo instanceof Response)) return demo;
  }
  const showcase = cfg.showcaseSlug ? await getNamespaceBySlug(db, cfg.showcaseSlug) : undefined;
  if (!showcase) return unauthorized();
  return { kind: 'showcase', namespaceId: showcase.id, writable: false };
}
