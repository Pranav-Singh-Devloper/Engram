// Routes wired for tests: the local database, a FakeProvider, a simulated
// clock, and a `defer` that queues work instead of running it, so a test can
// check what happens before and after the response.
import { randomUUID } from 'node:crypto';
import { FakeProvider, SimClock } from '@engram/core';
import type { Sql } from '@engram/core';
import { tokenResolver } from '@engram/mcp';
import type { WebConfig } from './config';
import { createRoutes } from './routes';

export const TEST_TOKEN = 't'.repeat(32);

export function testRoutes(
  db: Sql,
  overrides: Partial<WebConfig> = {},
  provider = new FakeProvider(),
) {
  const tokenSlug = `test-web-${randomUUID()}`;
  const config: WebConfig = {
    resolveToken: tokenResolver(new Map([[TEST_TOKEN, tokenSlug]])),
    mcpTokens: new Map([[TEST_TOKEN, tokenSlug]]),
    rememberWaitDefault: true,
    showcaseSlug: undefined,
    ipHashSecret: randomUUID(), // a fresh secret per test isolates throttle keys
    dailyTurnCap: 1e9,
    secureCookies: true,
    reportsDir: null,
    ...overrides,
  };
  const clock = new SimClock('2026-10-19T12:00:00Z');
  const deferred: (() => Promise<void>)[] = [];
  const routes = createRoutes({ db, provider, config, clock, defer: (t) => deferred.push(t) });
  return {
    routes,
    provider,
    clock,
    config,
    tokenSlug,
    /** Runs the work queued "after the response", as Next would. */
    runDeferred: async () => {
      for (const t of deferred.splice(0)) await t();
    },
  };
}

/** The `name=value` part of a Set-Cookie header, ready for a Cookie header. */
export const cookieFrom = (res: Response) => res.headers.get('set-cookie')?.split(';')[0] ?? '';
