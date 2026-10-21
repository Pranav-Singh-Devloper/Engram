// Build-time data that comes from the engine itself (P09c chapters 2–4):
// the golden fixtures' recorded calls and outcomes, the bitemporal story
// replayed through the real engine on the local database, and SPEC §7.4's
// cases joined to the tests that prove them.
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_DATABASE_URL, createDb, ensureNamespace, factsAsOf, history } from '@engram/core';
import { PORTABLE, migrate } from '@engram/core/migrate';
import { STORY_NOW, STORY_QUESTIONS, STORY_TURNS, Scenario } from '@engram/core/testing';

const ROOT = path.resolve(import.meta.dirname, '../..');
const FIXTURES = path.join(ROOT, 'packages/core/fixtures');

/** The golden fixtures: turns, the model's recorded replies, and what the engine did with them. */
export function writePath() {
  return readdirSync(path.join(FIXTURES, 'conversations'))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const c = JSON.parse(readFileSync(path.join(FIXTURES, 'conversations', f), 'utf8')) as {
        id: string;
        covers: string;
        episodes: unknown[];
        recording: {
          model: string;
          calls: { method: string; input: Record<string, unknown>; output: unknown }[];
        };
      };
      const expected = JSON.parse(
        readFileSync(path.join(FIXTURES, 'expected', f), 'utf8'),
      ) as Record<string, unknown>;
      return {
        id: c.id,
        covers: c.covers,
        model: c.recording.model,
        episodes: c.episodes,
        // The predicate list is the same registry on every call; it's shown once, not per call.
        calls: c.recording.calls.map(({ method, input, output }) => {
          const { predicates, ...rest } = input;
          return { method, input: rest, output };
        }),
        expected,
      };
    });
}

/** SPEC §7.4's required cases, each with the test that covers it. */
export function cases() {
  const spec = readFileSync(path.join(ROOT, 'docs/SPEC.md'), 'utf8');
  const section = spec.slice(spec.indexOf('### 7.4'), spec.indexOf('## 8.'));
  const testFile = 'packages/core/src/conflict/conflict.int.test.ts';
  const tests = readFileSync(path.join(ROOT, testFile), 'utf8').split('\n');
  return [...section.matchAll(/^(\d+)\. (.+)$/gm)].map((m) => {
    const n = Number(m[1]);
    const line = tests.findIndex((l) => l.includes(`it('${String(n)}. `));
    return {
      n,
      text: m[2] ?? '',
      test:
        line >= 0
          ? {
              file: testFile,
              line: line + 1,
              title: /it\('([^']+)'/.exec(tests[line] ?? '')?.[1] ?? '',
            }
          : null,
    };
  });
}

/** The bitemporal story replayed through the engine: every fact version, the revision log, and the engine's answers. */
export async function bitemporal() {
  const db = createDb(process.env.DATABASE_URL || DEFAULT_DATABASE_URL, { max: 2 });
  await migrate(db, { sources: [PORTABLE] });
  const ns = await ensureNamespace(db, { slug: `explorer-${randomUUID()}`, kind: 'demo' });
  try {
    const s = new Scenario(db, ns);
    for (const t of STORY_TURNS) await s.tell(t);
    s.clock.set(STORY_NOW);
    const versions = await history(db, ns.namespace.id, ns.selfEntity.id, { includeRevised: true });
    const revisions = await db<
      {
        oldFactId: string | null;
        newFactId: string | null;
        kind: string;
        resolver: string;
        reason: string | null;
        createdAt: Date;
      }[]
    >`
      select old_fact_id, new_fact_id, kind, resolver, reason, created_at from fact_revisions
      where namespace_id = ${ns.namespace.id} order by created_at, id`;
    const answers = [];
    for (const q of STORY_QUESTIONS) {
      const facts = await factsAsOf(
        db,
        {
          namespaceId: ns.namespace.id,
          subjectId: ns.selfEntity.id,
          predicate: q.predicate,
          validAt: q.validAt ? new Date(q.validAt) : undefined,
          knownAt: q.knownAt ? new Date(q.knownAt) : undefined,
        },
        s.clock,
      );
      answers.push({ ...q, engine: facts.map((f) => f.id) });
    }
    const unknown = (d: Date) => (d.getTime() <= -8.64e15 ? null : d.toISOString());
    return {
      now: STORY_NOW,
      turns: STORY_TURNS.map((t) => ({
        at: t.at,
        learnedAt: t.learnedAt ?? t.at,
        content: t.content,
        note: t.note ?? null,
      })),
      versions: versions.map((v) => ({
        id: v.fact.id,
        predicate: v.fact.predicate,
        object: v.objectName,
        statement: v.fact.statement,
        status: v.fact.status,
        validFrom: unknown(v.fact.validFrom),
        validTo: v.fact.validTo?.toISOString() ?? null,
        recordedAt: v.fact.recordedAt.toISOString(),
        invalidatedAt: v.fact.invalidatedAt?.toISOString() ?? null,
        revises: v.fact.revises,
        supersededBy: v.fact.supersededBy,
      })),
      revisions: revisions.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      answers,
    };
  } finally {
    await db`delete from namespaces where id = ${ns.namespace.id}`;
    await db.end();
  }
}
