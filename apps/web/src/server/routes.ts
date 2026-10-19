// Every route's logic, built from injected dependencies so tests can call
// handlers with plain Requests, a FakeProvider and the local database. The
// app/api/**/route.ts files only wire the real dependencies (P09a decision 6).
import type { Sql } from '@engram/core';
import { health } from './health';

export interface Deps {
  db: Sql;
}

export function createRoutes(deps: Deps) {
  return {
    health: () => health(deps.db),
  };
}

export type Routes = ReturnType<typeof createRoutes>;
