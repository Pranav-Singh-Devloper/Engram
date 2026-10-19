// The real dependencies, built once per function instance.
import { DEFAULT_DATABASE_URL } from '@engram/core';
import { createWebDb } from './db';
import { createRoutes } from './routes';
import type { Routes } from './routes';

let routes: Routes | undefined;

export function getRoutes(): Routes {
  routes ??= createRoutes({
    // Vercel: Neon's direct endpoint, one connection per instance (SPEC §11).
    db: createWebDb(process.env.DATABASE_URL || DEFAULT_DATABASE_URL),
  });
  return routes;
}
