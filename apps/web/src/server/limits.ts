// The demo's limits (P09a decision 4, SPEC §11). They protect the free Gemini
// quota: the per-IP throttle only raises the cost of minting sessions, and the
// global daily cap is the real bound on spend.
import { createHmac } from 'node:crypto';
import { bumpNamespaceRate, bumpThrottle, windowStart } from '@engram/core';
import type { Sql } from '@engram/core';

export const LIMITS = {
  sessionsPerIpHour: 5,
  sessionsPerIpDay: 20,
  turnsPerNamespaceHour: 30,
} as const;

/** Vercel sets x-real-ip; otherwise the first x-forwarded-for hop. */
export function clientIp(req: Request): string {
  return (
    req.headers.get('x-real-ip')?.trim() ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/**
 * The throttle key for an IP: an HMAC of the UTC day and the IP. It changes
 * every day and can't be reversed or matched across days without the secret,
 * so no stored row identifies a visitor.
 */
export function ipKey(secret: string, ip: string, now: Date): string {
  const day = now.toISOString().slice(0, 10);
  return createHmac('sha256', secret).update(`${day}|${ip}`).digest('hex');
}

const tooMany = (message: string, retryAfter: number) =>
  Response.json(
    { error: message },
    { status: 429, headers: { 'retry-after': String(Math.max(1, Math.ceil(retryAfter))) } },
  );

const secondsUntil = (now: Date, size: 'hour' | 'day') =>
  (windowStart(now, size).getTime() + (size === 'hour' ? 3_600_000 : 86_400_000) - now.getTime()) /
  1000;

/** Counts a session creation for the client; a 429 when over the hourly or daily limit. */
export async function throttleSession(
  db: Sql,
  secret: string,
  req: Request,
  now: Date,
): Promise<Response | null> {
  const key = ipKey(secret, clientIp(req), now);
  const hour = await bumpThrottle(db, 'session-ip-hour', key, windowStart(now, 'hour'));
  if (hour > LIMITS.sessionsPerIpHour) {
    return tooMany(
      'Too many demo sessions from this network. Try again later.',
      secondsUntil(now, 'hour'),
    );
  }
  const day = await bumpThrottle(db, 'session-ip-day', key, windowStart(now, 'day'));
  if (day > LIMITS.sessionsPerIpDay) {
    return tooMany('Too many demo sessions from this network today.', secondsUntil(now, 'day'));
  }
  return null;
}

export type TurnVerdict = 'ok' | 'namespace' | 'global';

/**
 * Takes one chat turn: the namespace's hourly limit first (so a visitor over
 * it doesn't spend the global budget), then the global daily cap.
 */
export async function takeChatTurn(
  db: Sql,
  namespaceId: string,
  dailyCap: number,
  now: Date,
): Promise<TurnVerdict> {
  const mine = await bumpNamespaceRate(db, namespaceId, windowStart(now, 'hour'));
  if (mine > LIMITS.turnsPerNamespaceHour) return 'namespace';
  const all = await bumpThrottle(db, 'demo-turns', 'all', windowStart(now, 'day'));
  return all > dailyCap ? 'global' : 'ok';
}
