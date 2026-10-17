// `pnpm jobs:maintain`: the in-database maintenance (SPEC §6.4): the decay
// sweep over every namespace, then demo cleanup. The nightly workflow runs it
// against the hosted database. Neon scales to zero, so pg_cron there would
// only fire while something else kept the compute awake (ADR-014).
import { existsSync } from 'node:fs';
import path from 'node:path';
import { cleanupDemoNamespaces, createDb, decaySweep } from '@engram/core';
import { parseMaintainArgs } from './jobs.js';

const envFile = path.resolve(import.meta.dirname, '../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

async function main(): Promise<void> {
  const args = parseMaintainArgs(process.argv.slice(2), process.env);
  const db = createDb(args.url, { max: 1 });
  try {
    const now = new Date();
    const { archived } = await decaySweep(db, { now });
    const deleted = await cleanupDemoNamespaces(db, now);
    console.log(
      `decay sweep archived ${archived} fact(s); demo cleanup deleted ${deleted} namespace(s)`,
    );
  } finally {
    await db.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
