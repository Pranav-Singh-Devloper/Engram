import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { testDb, withTestNamespace } from '@engram/core/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { LIMITS, clientIp, ipKey, takeChatTurn, throttleSession } from './limits';

const db = testDb();
const SECRET = 'test-secret';
afterAll(async () => {
  await db.end();
});

const from = (ip: string) =>
  new Request('http://x/api/demo/session', { headers: { 'x-real-ip': ip } });

describe('client IP', () => {
  it('prefers x-real-ip, then the first forwarded hop', () => {
    expect(
      clientIp(new Request('http://x', { headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2' } })),
    ).toBe('1.1.1.1');
    expect(clientIp(from('3.3.3.3'))).toBe('3.3.3.3');
    expect(clientIp(new Request('http://x'))).toBe('unknown');
  });

  it('hashes to a key that changes every day and never contains the IP', () => {
    const a = ipKey(SECRET, '10.1.2.3', new Date('2026-10-19T10:00:00Z'));
    expect(a).toBe(ipKey(SECRET, '10.1.2.3', new Date('2026-10-19T23:59:00Z')));
    expect(a).not.toBe(ipKey(SECRET, '10.1.2.3', new Date('2026-10-20T00:00:00Z')));
    expect(a).not.toContain('10.1.2.3');
  });
});

describe('session throttle', () => {
  it('refuses the 6th session from one IP within an hour, and leaves other IPs alone', async () => {
    const ip = `10.${String(Math.floor(Math.random() * 250))}.0.1`;
    const now = new Date(`2026-10-19T0${String(Math.floor(Math.random() * 9))}:30:00Z`);
    const secret = randomUUID(); // a fresh secret isolates this run's keys
    for (let i = 0; i < LIMITS.sessionsPerIpHour; i++) {
      expect(await throttleSession(db, secret, from(ip), now)).toBeNull();
    }
    const refused = await throttleSession(db, secret, from(ip), now);
    expect(refused?.status).toBe(429);
    expect(Number(refused?.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await throttleSession(db, secret, from('192.0.2.7'), now)).toBeNull();
    // No stored row carries the IP itself.
    const rows = await db<
      { key: string }[]
    >`select key from throttles where bucket like 'session-ip-%'`;
    expect(rows.some((r) => r.key.includes(ip))).toBe(false);
  });

  it('keeps raw IPs out of the code that writes rows (source scan)', () => {
    const src = readFileSync(new URL('./limits.ts', import.meta.url), 'utf8');
    // Every throttle write goes through ipKey, never clientIp directly.
    expect(src).toMatch(/const key = ipKey\(secret, clientIp\(req\), now\)/);
    expect(src).not.toMatch(/bumpThrottle\([^)]*clientIp/);
  });
});

describe('chat turns', () => {
  it('limits a namespace to 30 turns an hour before touching the global cap', async () => {
    await withTestNamespace(db, async (ns) => {
      const now = new Date('2026-10-19T09:15:00Z');
      for (let i = 0; i < LIMITS.turnsPerNamespaceHour; i++) {
        expect(await takeChatTurn(db, ns.namespace.id, 1e9, now)).toBe('ok');
      }
      expect(await takeChatTurn(db, ns.namespace.id, 1e9, now)).toBe('namespace');
    });
  });

  it('applies the global daily cap across namespaces', async () => {
    await withTestNamespace(db, async (ns) => {
      // A day no other test uses; its counter is cleared before and after.
      const now = new Date('2031-03-14T12:00:00Z');
      const clear = () =>
        db`delete from throttles where bucket = 'demo-turns' and window_start = '2031-03-14T00:00:00Z'`;
      await clear();
      expect(await takeChatTurn(db, ns.namespace.id, 2, now)).toBe('ok');
      expect(await takeChatTurn(db, ns.namespace.id, 2, now)).toBe('ok');
      expect(await takeChatTurn(db, ns.namespace.id, 2, now)).toBe('global');
      await clear();
    });
  });
});
