// Build-time data that comes from the engine itself (P09c chapters 2–4):
// the golden fixtures' recorded calls and outcomes, the bitemporal story
// replayed through the real engine on the local database, and SPEC §7.4's
// cases joined to the tests that prove them, and real recall traces (chapter 6).
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_DATABASE_URL,
  FakeProvider,
  createDb,
  ensureNamespace,
  factsAsOf,
  history,
  recall,
  withEmbedder,
} from '@engram/core';
import type { Embedder } from '@engram/core';
import { PORTABLE, migrate } from '@engram/core/migrate';
import { STORY_NOW, STORY_QUESTIONS, STORY_TURNS, Scenario, aboutSelf } from '@engram/core/testing';
import type { Turn } from '@engram/core/testing';

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

const LEILA = { name: 'Leila', type: 'person' as const, description: "the user's sister" };

/** The story plus a few other topics, so recall has distractors and a graph hop to show. */
export const RECALL_TURNS: Turn[] = [
  ...STORY_TURNS,
  {
    at: '2024-02-22T09:00:00Z',
    content: 'My sister Leila is over in Lisbon.',
    candidates: [
      aboutSelf('sibling_of', 'Leila', {
        type: 'person',
        subject: LEILA,
        statement: "Leila is the user's sister.",
      }),
      aboutSelf('lives_in', 'Lisbon', { subject: LEILA, statement: 'Leila resides in Lisbon.' }),
    ],
  },
  {
    at: '2024-03-01T09:00:00Z',
    content: 'I play the cello.',
    candidates: [
      aboutSelf('plays', 'cello', { type: 'thing', statement: 'The user plays the cello.' }),
    ],
  },
  {
    at: '2024-04-19T09:00:00Z',
    content: "I'm allergic to penicillin.",
    candidates: [
      aboutSelf('allergic_to', 'penicillin', {
        literal: true,
        statement: 'The user is allergic to penicillin.',
      }),
    ],
  },
  {
    at: '2024-05-12T09:00:00Z',
    content: 'We adopted a beagle called Biscuit.',
    candidates: [
      aboutSelf('owns', 'Biscuit', { type: 'thing', statement: 'The user has a beagle, Biscuit.' }),
    ],
  },
  {
    at: '2024-08-20T09:00:00Z',
    content: 'Ramen is my favourite food.',
    candidates: [
      aboutSelf('likes', 'ramen', { type: 'thing', statement: 'The user likes ramen.' }),
    ],
  },
];

export const RECALL_QUERIES = [
  'Where do I live?',
  'Which city does my sister live in?',
  'penicillin allergy?',
  'Do I have any pets?',
  'quantum chromodynamics lattice',
];

/**
 * recall() traced on RECALL_TURNS: scripted extraction (no model calls) over
 * real embeddings, so the similarities and rankings are the engine's own.
 */
export async function recallTraces(embedder: Embedder) {
  const db = createDb(process.env.DATABASE_URL || DEFAULT_DATABASE_URL, { max: 2 });
  await migrate(db, { sources: [PORTABLE] });
  const ns = await ensureNamespace(db, { slug: `explorer-${randomUUID()}`, kind: 'demo' });
  try {
    const fake = new FakeProvider();
    for (const t of RECALL_TURNS) {
      fake.when('processEpisode', (input) => input.content === t.content, {
        importance: t.importance ?? 0.5,
        candidates: t.candidates,
      });
    }
    const s = new Scenario(db, ns, undefined, withEmbedder(fake, embedder));
    for (const t of RECALL_TURNS) await s.tell(t);
    s.clock.set(STORY_NOW);
    const traces = [];
    for (const query of RECALL_QUERIES) {
      const r = await recall(
        db,
        withEmbedder(fake, embedder),
        { namespaceId: ns.namespace.id, query, trackAccess: false, trace: true },
        s.clock,
      );
      if (!r.trace) throw new Error('recall returned no trace');
      // The linear ranker on the same candidates, so the explorer can compare the two.
      const linear = await recall(
        db,
        withEmbedder(fake, embedder),
        {
          namespaceId: ns.namespace.id,
          query,
          trackAccess: false,
          trace: true,
          ranker: 'linear',
          floor: 0,
        },
        s.clock,
      );
      traces.push({
        linearScores: Object.fromEntries(
          (linear.trace?.candidates ?? []).map((c) => [c.key, c.score]),
        ),
        query,
        abstained: r.abstained,
        bestSimilarity: r.bestSimilarity,
        returned: r.memories.map((m) => `${m.kind === 'fact' ? 'f' : 'e'}:${m.id}`),
        ...r.trace,
      });
    }
    return {
      now: STORY_NOW,
      space: await embedder.embeddingSpace(),
      k: 8,
      turns: RECALL_TURNS.length,
      traces,
    };
  } finally {
    await db`delete from namespaces where id = ${ns.namespace.id}`;
    await db.end();
  }
}
