// Every route's logic, built from injected dependencies so tests can call
// handlers with plain Requests, a FakeProvider and the local database. The
// app/api/**/route.ts files only wire the real dependencies (P09a decision 6).
import type { Clock, Provider, Sql } from '@engram/core';
import type { WebConfig } from './config';
import { createDemoSession } from './demo';
import { health } from './health';

export interface Deps {
  db: Sql;
  provider: Provider;
  config: WebConfig;
  clock: Clock;
  /** Work to run after the response is sent: Next's `after()` in production. */
  defer: (task: () => Promise<void>) => void;
}

export function createRoutes(deps: Deps) {
  const { db, config, clock } = deps;
  return {
    health: () => health(db),
    demoSession: (req: Request) => createDemoSession(db, config, clock, req),
  };
}

export type Routes = ReturnType<typeof createRoutes>;
