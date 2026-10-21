// The offline bitemporal demo: the real engine on the local database, with a
// scripted FakeProvider instead of an LLM, so it needs no API keys. It
// replays a short life story out of order and asks the questions the
// bitemporal model exists to answer. Exits non-zero if any answer is wrong,
// so CI runs it as a smoke test.
//
//   pnpm db:up && pnpm demo:offline        (add --keep to leave the namespace for inspection)
//   ENGRAM_PROVIDER=ollama pnpm demo:offline --live
// --live sends the same turns to the configured model instead (local mode's
// manual offline check, docs/local.md); a real model may answer differently.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_DATABASE_URL,
  UNKNOWN_START,
  createDb,
  ensureNamespace,
  history,
  providerFromEnv,
} from '@engram/core';
import { PORTABLE, migrate } from '@engram/core/migrate';
import {
  STORY_NOW as NOW,
  STORY_QUESTIONS as questions,
  STORY_TURNS as turns,
  Scenario,
} from '@engram/core/testing';

const day = (d: Date | null) =>
  d === null
    ? 'open'
    : d.getTime() === UNKNOWN_START.getTime()
      ? 'unknown'
      : d.toISOString().slice(0, 10);

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
  const db = createDb(url, { max: 2 });
  // Idempotent, so a fresh clone needs only `pnpm db:up` first.
  await migrate(db, { sources: [PORTABLE] });
  const ns = await ensureNamespace(db, { slug: `demo-offline-${randomUUID()}`, kind: 'demo' });
  let failures = 0;
  const live = process.argv.includes('--live');
  // Only a live run reads .env (for model settings); the scripted demo needs nothing.
  const envFile = path.resolve(import.meta.dirname, '../.env');
  if (live && existsSync(envFile)) process.loadEnvFile(envFile);
  try {
    const s = new Scenario(db, ns, undefined, live ? providerFromEnv(process.env) : undefined);
    console.log(
      live
        ? `Engram demo: the real engine and the ${process.env.ENGRAM_PROVIDER ?? 'gemini'} model.\n`
        : 'Engram offline demo: the real engine, a scripted model, no API keys.\n',
    );
    console.log('What the user said, in the order the system heard it:');
    for (const turn of turns) {
      await s.tell(turn);
      const said = `"${turn.content}"`.padEnd(48);
      console.log(`  ${turn.at.slice(0, 10)}  ${said} ${turn.note ? `→ ${turn.note}` : ''}`);
    }

    s.clock.set(NOW);
    console.log(`\nQuestions, asked on ${NOW.slice(0, 10)}:`);
    for (const q of questions) {
      const got = await s.values(q.predicate, { validAt: q.validAt, knownAt: q.knownAt });
      const ok = JSON.stringify(got) === JSON.stringify(q.expected);
      if (!ok) failures++;
      const answer = got.length > 0 ? got.join(', ') : '(nothing)';
      const miss = ok ? '' : `   expected ${q.expected.join(', ') || '(nothing)'}`;
      console.log(`  ${ok ? '✓' : '✗'} ${q.ask.padEnd(60)} ${answer}${miss}`);
    }

    console.log(
      '\nTimeline of lives_in, including replaced versions (the record-time audit view):',
    );
    console.log(
      `  ${'city'.padEnd(10)} ${'valid'.padEnd(26)} ${'believed (record time)'.padEnd(26)} status`,
    );
    for (const e of await history(db, ns.namespace.id, ns.selfEntity.id, {
      predicate: 'lives_in',
      includeRevised: true,
    })) {
      const f = e.fact;
      const valid = `${day(f.validFrom)} → ${day(f.validTo)}`;
      const believed = `${day(f.recordedAt)} → ${f.invalidatedAt ? day(f.invalidatedAt) : 'now'}`;
      console.log(
        `  ${e.objectName.padEnd(10)} ${valid.padEnd(26)} ${believed.padEnd(26)} ${f.status}`,
      );
    }

    const problems = await s.checkInvariants();
    if (problems.length > 0) {
      failures += problems.length;
      console.log(`\nInvariant violations:\n  ${problems.join('\n  ')}`);
    }
    console.log(failures === 0 ? '\nAll answers correct.' : `\n${failures} problem(s).`);
  } finally {
    if (!process.argv.includes('--keep')) {
      await db`delete from namespaces where id = ${ns.namespace.id}`;
    }
    await db.end();
  }
  if (failures > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  const message =
    err instanceof Error ? err.message || (err as { code?: string }).code : String(err);
  console.error(`demo:offline failed: ${message ?? 'unknown error'}`);
  if ((err as { code?: string }).code === 'ECONNREFUSED')
    console.error('Is the database up? Run `pnpm db:up`.');
  process.exitCode = 1;
});
