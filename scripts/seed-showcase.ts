// pnpm seed:showcase [--hosted] [--replace] [--scripted]
// Seeds the read-only showcase namespace (ENGRAM_SHOWCASE_NAMESPACE, default
// "showcase") with the bitemporal story, extracted by the configured model
// (Gemini by default: ~6 extraction calls and ~20 embedded texts), then checks
// every canonical answer. --scripted uses the story's scripted extraction
// instead (no model calls). --hosted seeds HOSTED_DATABASE_URL (run
// `pnpm db:migrate:hosted` first); otherwise DATABASE_URL or the local database.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_DATABASE_URL, createDb, isLocalUrl, providerFromEnv } from '@engram/core';
import { PORTABLE, migrate } from '@engram/core/migrate';
import { seedShowcase } from './showcase.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => !['--hosted', '--replace', '--scripted'].includes(a));
  if (unknown.length > 0) throw new Error(`Unknown argument(s): ${unknown.join(' ')}`);
  const envFile = path.resolve(import.meta.dirname, '../.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const hosted = args.includes('--hosted');
  const url = hosted
    ? process.env.HOSTED_DATABASE_URL
    : process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
  if (!url) throw new Error('HOSTED_DATABASE_URL is not set.');
  if (hosted && isLocalUrl(url)) throw new Error('--hosted points at a local database.');
  const slug = process.env.ENGRAM_SHOWCASE_NAMESPACE?.trim() || 'showcase';
  const scripted = args.includes('--scripted');

  const db = createDb(url, { max: 2 });
  try {
    // Locally the portable migrations are idempotent; the hosted database is migrated by db:migrate:hosted.
    if (!hosted) await migrate(db, { sources: [PORTABLE] });
    console.log(
      `Seeding "${slug}" on the ${hosted ? 'hosted' : 'local'} database, ${scripted ? 'with scripted extraction' : `extracted by ${process.env.ENGRAM_PROVIDER ?? 'gemini'}`}…`,
    );
    const r = await seedShowcase(db, {
      slug,
      provider: scripted ? undefined : providerFromEnv(process.env),
      replace: args.includes('--replace'),
    });
    for (const a of r.answers)
      console.log(
        `  ${a.gap ? '○' : '✓'} ${a.ask.padEnd(60)} ${a.got.join(', ') || '(nothing)'}${a.gap ? `   known gap: ${a.gap}` : ''}`,
      );
    const gaps = r.answers.filter((a) => a.gap).length;
    console.log(
      `Seeded ${String(r.facts)} fact versions; every answer verified${gaps ? `, ${String(gaps)} documented gap` : ''}.`,
    );
  } finally {
    await db.end();
  }
}

main().catch((err: unknown) => {
  console.error(`seed:showcase failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
