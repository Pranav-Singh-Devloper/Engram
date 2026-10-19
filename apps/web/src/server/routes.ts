// Every route's logic, built from injected dependencies so tests can call
// handlers with plain Requests, a FakeProvider and the local database. The
// app/api/**/route.ts files only wire the real dependencies (P09a decision 6).
import type { Clock, Provider, Sql } from '@engram/core';
import { demoAccess, readAccess, tokenAccess } from './auth';
import { chat } from './chat';
import type { WebConfig } from './config';
import { createDemoSession } from './demo';
import { health } from './health';
import { entityTimeline, listEvals, listMemories } from './reads';
import { recallRoute, remember } from './writes';

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
    memories: async (req: Request) => {
      const access = await readAccess(db, config, req, clock.now());
      return access instanceof Response
        ? access
        : listMemories(db, access, new URL(req.url), clock.now());
    },
    timeline: async (req: Request, entityId: string) => {
      const access = await readAccess(db, config, req, clock.now());
      return access instanceof Response
        ? access
        : entityTimeline(db, access, entityId, new URL(req.url));
    },
    evals: () => listEvals(config.reportsDir),
    remember: async (req: Request) => {
      const access = await tokenAccess(db, config, req);
      return access instanceof Response ? access : remember(deps, access, req);
    },
    chat: async (req: Request) => {
      const access = await demoAccess(db, req, clock.now());
      return access instanceof Response
        ? access
        : chat({ ...deps, dailyTurnCap: config.dailyTurnCap }, access, req);
    },
    recall: async (req: Request) => {
      const access = await tokenAccess(db, config, req);
      return access instanceof Response ? access : recallRoute(deps, access, req);
    },
  };
}

export type Routes = ReturnType<typeof createRoutes>;
