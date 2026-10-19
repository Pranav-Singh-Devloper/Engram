// The web app's database client. Vercel runs many short-lived instances, so
// each holds one connection to Neon's direct endpoint and lets it go quickly.
// Prepared statements are off: free on the direct endpoint, and required if
// traffic ever moves to the pooled one (SPEC §11; ledger rows 6 and 35).
import { createDb } from '@engram/core';
import type { DbOptions, Sql } from '@engram/core';

export const WEB_DB_OPTIONS = {
  max: 1,
  prepare: false,
  idleTimeout: 20,
} as const satisfies DbOptions;

export function createWebDb(url: string): Sql {
  return createDb(url, WEB_DB_OPTIONS);
}
