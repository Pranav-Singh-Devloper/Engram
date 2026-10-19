// The real dependencies, built once per function instance.
import { DEFAULT_DATABASE_URL, providerFromEnv, systemClock } from '@engram/core';
import { after } from 'next/server';
import { configFromEnv } from './config';
import { createWebDb } from './db';
import { createRoutes } from './routes';
import type { Routes } from './routes';

let routes: Routes | undefined;

export function getRoutes(): Routes {
  routes ??= createRoutes({
    // Vercel: Neon's direct endpoint, one connection per instance (SPEC §11).
    db: createWebDb(process.env.DATABASE_URL || DEFAULT_DATABASE_URL),
    provider: providerFromEnv(process.env),
    config: configFromEnv(process.env),
    clock: systemClock,
    // Post-response work, within the function's duration limit (300 s on Hobby).
    defer: (task) => {
      after(task);
    },
  });
  return routes;
}
