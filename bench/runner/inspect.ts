// Replays bench items through the engram write path and prints what the store
// made of each turn: resolution outcomes, the fact timeline with replaced
// versions, and the revision log. The fastest way to see why engram missed.
//
//   pnpm bench:inspect dev-014 [dev-028 ...] [--split=dev] [--offline]
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_DATABASE_URL,
  SimClock,
  UNKNOWN_START,
  createDb,
  ensureNamespace,
  history,
  ingest,
  processEpisode,
} from '@engram/core';
import { SplitFile, turnTime } from '../dataset/schema.js';
import { BENCH_DIR, loadEnv, makeProviders } from './providers.js';

const day = (d: Date | null) =>
  d === null
    ? 'open'
    : d.getTime() === UNKNOWN_START.getTime()
      ? 'unknown'
      : d.toISOString().slice(0, 10);

async function main(): Promise<void> {
  loadEnv();
  const split = process.argv.find((a) => a.startsWith('--split='))?.slice(8) ?? 'dev';
  const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const file = SplitFile.parse(
    JSON.parse(readFileSync(path.join(BENCH_DIR, 'dataset', `${split}.json`), 'utf8')),
  );
  const { gemini } = makeProviders({
    mode: process.argv.includes('--offline') ? 'readonly' : 'readwrite',
  });
  const db = createDb(process.env.DATABASE_URL || DEFAULT_DATABASE_URL, { max: 2 });
  try {
    for (const id of ids) {
      const item = file.items.find((i) => i.id === id);
      if (!item) throw new Error(`No item ${id} in ${split}.json`);
      const { namespace, selfEntity } = await ensureNamespace(db, {
        slug: `inspect-${id}-${randomUUID()}`,
        kind: 'bench',
      });
      const clock = new SimClock(item.asked_at);
      console.log(`\n### ${id} (${item.category}): ${item.question} → expected ${item.expected}`);
      try {
        for (const s of item.setup_sessions) {
          for (const [i, text] of s.turns.entries()) {
            const at = turnTime(s, i);
            clock.set(at);
            const ep = await ingest(
              db,
              gemini,
              {
                namespaceId: namespace.id,
                sessionId: s.session_id,
                role: 'user',
                content: text,
                occurredAt: at,
              },
              { clock },
            );
            const sum = await processEpisode(db, gemini, ep.id, { clock });
            const outcomes = Object.entries(sum.outcomes)
              .filter(([, n]) => n > 0)
              .map(([k, n]) => `${k}:${n}`)
              .join(' ');
            console.log(`  ${day(at)} "${text}" → ${outcomes || 'nothing'}`);
          }
        }
        console.log('  timeline (user, including replaced versions):');
        for (const e of await history(db, selfEntity.id, { includeRevised: true })) {
          const f = e.fact;
          console.log(
            `    ${f.predicate} ${e.objectName} [${day(f.validFrom)} → ${day(f.validTo)}] ${f.status}${e.replaced ? ' (replaced)' : ''}`,
          );
        }
        const revisions = await db<{ kind: string; resolver: string; reason: string | null }[]>`
          select kind, resolver, reason from fact_revisions
          where namespace_id = ${namespace.id} order by created_at, id`;
        for (const r of revisions)
          console.log(`  revision: ${r.kind} (${r.resolver}) ${r.reason ?? ''}`);
        const dupes = await db<{ name: string; n: number }[]>`
          select min(name) as name, count(*)::int as n from entities
          where namespace_id = ${namespace.id} and not is_self
          group by lower(name) having count(*) > 1`;
        for (const d of dupes) console.log(`  duplicate entity: ${d.name} ×${d.n}`);
      } finally {
        await db`delete from namespaces where id = ${namespace.id}`;
      }
    }
  } finally {
    await db.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
