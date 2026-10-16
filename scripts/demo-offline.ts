// The offline bitemporal demo: the real engine on the local database, with a
// scripted FakeProvider instead of an LLM, so it needs no API keys. It
// replays a short life story out of order and asks the questions the
// bitemporal model exists to answer. Exits non-zero if any answer is wrong,
// so CI runs it as a smoke test.
//
//   pnpm db:up && pnpm demo:offline        (add --keep to leave the namespace for inspection)
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_DATABASE_URL,
  UNKNOWN_START,
  createDb,
  ensureNamespace,
  history,
} from '@engram/core';
import { PORTABLE, migrate } from '@engram/core/migrate';
import { Scenario, aboutSelf, hint } from '@engram/core/testing';
import type { Turn } from '@engram/core/testing';

const turns: (Turn & { note?: string })[] = [
  {
    at: '2024-01-15T09:00:00Z',
    content: 'I live in Paris.',
    candidates: [aboutSelf('lives_in', 'Paris')],
  },
  {
    at: '2024-06-10T09:00:00Z',
    content: 'I moved to Berlin in March.',
    candidates: [aboutSelf('lives_in', 'Berlin', { from: hint.month(3) })],
    note: 'update: Paris closes at 2024-03-01',
  },
  {
    at: '2024-07-01T09:00:00Z',
    content: 'I work at Initech.',
    candidates: [aboutSelf('works_at', 'Initech', { type: 'org' })],
  },
  {
    at: '2024-07-02T09:00:00Z',
    content: 'Actually, I work at Acme, not Initech.',
    candidates: [aboutSelf('works_at', 'Acme', { type: 'org', correction: true })],
    note: 'correction: Initech retracted',
  },
  {
    at: '2024-08-01T09:00:00Z',
    content: 'Before Paris I lived in Lyon, 2015 to 2018.',
    candidates: [aboutSelf('lives_in', 'Lyon', { from: hint.year(2015), to: hint.year(2018) })],
    note: 'backfill: older history learned later',
  },
  {
    at: '2024-08-01T09:05:00Z',
    content: 'And before that, Marseille.',
    candidates: [aboutSelf('lives_in', 'Marseille', { to: hint.year(2015) })],
    note: 'backfill with an unknown start',
  },
];

const NOW = '2024-09-01T00:00:00Z';

interface Question {
  ask: string;
  predicate: string;
  validAt?: string;
  knownAt?: string;
  expected: string[];
}

const questions: Question[] = [
  { ask: 'Where does the user live now?', predicate: 'lives_in', expected: ['Berlin'] },
  {
    ask: 'Where did they live on 2024-02-01?',
    predicate: 'lives_in',
    validAt: '2024-02-01',
    expected: ['Paris'],
  },
  {
    ask: 'On 2024-05-01, where did we think they lived?',
    predicate: 'lives_in',
    validAt: '2024-05-01',
    knownAt: '2024-05-01',
    expected: ['Paris'],
  },
  {
    ask: 'Knowing what we know now, where were they on 2024-05-01?',
    predicate: 'lives_in',
    validAt: '2024-05-01',
    expected: ['Berlin'],
  },
  {
    ask: 'Where did they live in 2016?',
    predicate: 'lives_in',
    validAt: '2016-06-01',
    expected: ['Lyon'],
  },
  {
    ask: 'In July, what did we know about 2016?',
    predicate: 'lives_in',
    validAt: '2016-06-01',
    knownAt: '2024-07-15',
    expected: [],
  },
  {
    ask: 'Where did they live in 2010?',
    predicate: 'lives_in',
    validAt: '2010-01-01',
    expected: ['Marseille'],
  },
  { ask: 'Where do they work now?', predicate: 'works_at', expected: ['Acme'] },
  {
    ask: 'Just before the correction, where did we think they worked?',
    predicate: 'works_at',
    knownAt: '2024-07-01T12:00:00Z',
    validAt: '2024-07-01T12:00:00Z',
    expected: ['Initech'],
  },
  {
    ask: 'Knowing what we know now, where did they work on 1 July?',
    predicate: 'works_at',
    validAt: '2024-07-01T12:00:00Z',
    expected: ['Acme'],
  },
];

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
  try {
    const s = new Scenario(db, ns);
    console.log('Engram offline demo: the real engine, a scripted model, no API keys.\n');
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
    for (const e of await history(db, ns.selfEntity.id, {
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
