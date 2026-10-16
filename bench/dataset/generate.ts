// Generates a bench split (SPEC §13.2): seeded persona timelines, verbalized
// by a model, with questions and exact answers from the timeline. Refuses to
// overwrite an existing split: dev.json and test.json are frozen once
// reviewed, and regenerating one is a deliberate act (delete it first).
//
//   pnpm bench:generate --split=dev [--seed=42] [--personas=8]
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv, makeProviders } from '../runner/providers.js';
import { buildPersona, rng } from './personas.js';
import type { Persona } from './personas.js';
import { questionsFor } from './questions.js';
import type { DraftItem } from './questions.js';
import { CATEGORIES, SplitFile } from './schema.js';
import type { BenchItem, Category, SetupSession } from './schema.js';
import { VERBALIZER_MODEL, verbalizeSession } from './verbalize.js';

/** Category counts per split (SPEC §13.1 for test; a 40-item mix for dev). */
export const TARGETS: Record<'dev' | 'test', Record<Category, number>> = {
  dev: {
    cross_session_recall: 12,
    knowledge_update: 8,
    temporal_reasoning: 6,
    single_session_recall: 6,
    multi_hop: 4,
    abstention: 4,
  },
  test: {
    cross_session_recall: 60,
    knowledge_update: 40,
    temporal_reasoning: 30,
    single_session_recall: 30,
    multi_hop: 20,
    abstention: 20,
  },
};

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function shuffled<T>(random: () => number, items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

/** Meets the category targets while keeping personas evenly represented. */
export function select(
  personas: readonly Persona[],
  targets: Record<Category, number>,
  seed: number,
): { persona: Persona; draft: DraftItem }[] {
  const random = rng(seed);
  const pools = new Map(personas.map((p) => [p.id, shuffled(random, questionsFor(p))]));
  const chosen: { persona: Persona; draft: DraftItem }[] = [];
  const taken = new Map(personas.map((p) => [p.id, 0]));
  for (const category of CATEGORIES) {
    const order = shuffled(random, personas);
    for (let need = targets[category]; need > 0; need--) {
      // The persona with the fewest items so far that still has one of this category.
      const candidates = order.filter((p) =>
        (pools.get(p.id) ?? []).some((d) => d.category === category),
      );
      const p = candidates.sort((a, b) => (taken.get(a.id) ?? 0) - (taken.get(b.id) ?? 0))[0];
      if (!p) throw new Error(`Not enough ${category} questions; add personas.`);
      const pool = pools.get(p.id) ?? [];
      const draft = pool.splice(
        pool.findIndex((d) => d.category === category),
        1,
      )[0] as DraftItem;
      chosen.push({ persona: p, draft });
      taken.set(p.id, (taken.get(p.id) ?? 0) + 1);
    }
  }
  return chosen;
}

async function main(): Promise<void> {
  loadEnv();
  const split = arg('split', 'dev') as 'dev' | 'test';
  const seed = Number(arg('seed', '42'));
  const count = Number(arg('personas', split === 'dev' ? '8' : '40'));
  const out = path.resolve(import.meta.dirname, `${split}.json`);
  if (existsSync(out)) {
    throw new Error(
      `${path.basename(out)} already exists and is frozen. Delete it deliberately to regenerate.`,
    );
  }

  const { verbalizer } = makeProviders();
  const llm = verbalizer(VERBALIZER_MODEL);
  const personas = Array.from({ length: count }, (_, i) => buildPersona(i, seed));

  const sessions = new Map<string, SetupSession[]>();
  for (const p of personas) {
    const forbid = p.neverMentions.flatMap((n) => n.forbid);
    const done: SetupSession[] = [];
    for (const plan of p.sessions) {
      const turns = await verbalizeSession(llm, p.name, plan, forbid);
      done.push({ session_id: plan.sessionId, occurred_at: plan.occurredAt.toISOString(), turns });
      console.log(`${plan.sessionId}: ${turns.length} turn(s)`);
    }
    sessions.set(p.id, done);
  }

  const chosen = select(personas, TARGETS[split], seed);
  chosen.sort(
    (a, b) =>
      a.persona.id.localeCompare(b.persona.id, 'en', { numeric: true }) ||
      a.draft.category.localeCompare(b.draft.category),
  );
  const items: BenchItem[] = chosen.map(({ persona, draft }, i) => {
    const all = sessions.get(persona.id) ?? [];
    return {
      id: `${split}-${String(i + 1).padStart(3, '0')}`,
      split,
      category: draft.category,
      persona: persona.id,
      setup_sessions: draft.sessions === 'first' ? all.slice(0, 1) : all,
      question: draft.question,
      asked_at: draft.askedAt.toISOString(),
      valid_at: draft.validAt?.toISOString() ?? null,
      known_at: draft.knownAt?.toISOString() ?? null,
      expected: draft.expected,
      judge: draft.judge,
      notes: draft.notes,
    };
  });

  const file = SplitFile.parse({
    split,
    seed,
    generated_at: new Date().toISOString(),
    verbalizer: VERBALIZER_MODEL,
    items,
  });
  writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
  const counts = CATEGORIES.map((c) => `${c} ${items.filter((i) => i.category === c).length}`).join(
    ', ',
  );
  console.log(`wrote ${items.length} items to ${path.basename(out)}: ${counts}`);
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
