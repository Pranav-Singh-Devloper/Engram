// The real dependencies, built once per function instance.
import { DEFAULT_DATABASE_URL, createDb } from '@engram/core';
import { createRoutes } from './routes';
import type { Routes } from './routes';

let routes: Routes | undefined;

export function getRoutes(): Routes {
  routes ??= createRoutes({
    // Vercel: Neon's direct endpoint, one connection per instance (SPEC §11).
    db: createDb(process.env.DATABASE_URL || DEFAULT_DATABASE_URL, { max: 1, prepare: false }),
  });
  return routes;
}
