// LongMemEval-S (MIT; github.com/xiaowu0162/LongMemEval) adapted to the
// Engram-Bench item format (SPEC §13.6, P08). Pure functions: the mapping and
// a seeded, stratified subset that keeps every question type, abstention in
// proportion. The data itself is downloaded to the gitignored data/ folder.
import { z } from 'zod';
import { rng } from '../dataset/personas.js';
import type { BenchItem, Category, SetupSession } from '../dataset/schema.js';

export const RawTurn = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  has_answer: z.boolean().optional(),
});

export const RawItem = z.object({
  question_id: z.string(),
  question_type: z.string(),
  question: z.string(),
  answer: z.union([z.string(), z.number()]),
  question_date: z.string(),
  haystack_session_ids: z.array(z.string()),
  haystack_dates: z.array(z.string()),
  haystack_sessions: z.array(z.array(RawTurn)),
});
export type RawItem = z.infer<typeof RawItem>;

/** LongMemEval's six question types, in the paper's order. */
export const LME_TYPES = [
  'single-session-user',
  'single-session-assistant',
  'single-session-preference',
  'multi-session',
  'knowledge-update',
  'temporal-reasoning',
] as const;

const CATEGORY: Record<string, Category> = {
  'single-session-user': 'single_session_recall',
  'single-session-assistant': 'single_session_recall',
  'single-session-preference': 'single_session_recall',
  'multi-session': 'cross_session_recall',
  'knowledge-update': 'knowledge_update',
  'temporal-reasoning': 'temporal_reasoning',
};

export const isAbstentionItem = (raw: Pick<RawItem, 'question_id'>) =>
  raw.question_id.endsWith('_abs');

/** "2023/05/20 (Sat) 02:21" → ISO 8601 (the dataset's times carry no zone; read as UTC). */
export function parseLmeDate(s: string): string {
  const m = /^(\d{4})\/(\d{2})\/(\d{2}) \(\w+\) (\d{2}):(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`Unrecognized LongMemEval date: ${s}`);
  const [, y, mo, d, h, mi] = m;
  return new Date(
    Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)),
  ).toISOString();
}

/** Stratum key: question type, with abstention items kept as their own stratum. */
export const stratum = (raw: Pick<RawItem, 'question_id' | 'question_type'>) =>
  `${raw.question_type}${isAbstentionItem(raw) ? '/abs' : ''}`;

export function toBenchItem(raw: RawItem): BenchItem {
  const sessions: SetupSession[] = raw.haystack_sessions.flatMap((turns, i) => {
    // Empty turns carry nothing and the item schema rejects them.
    const kept = turns.filter((t) => t.content.trim() !== '');
    if (kept.length === 0) return [];
    return [
      {
        session_id: raw.haystack_session_ids[i] ?? `s${i}`,
        occurred_at: parseLmeDate(raw.haystack_dates[i] ?? raw.question_date),
        turns: kept.map((t) => t.content),
        roles: kept.map((t) => t.role),
      },
    ];
  });
  sessions.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  return {
    id: `lme-${raw.question_id}`,
    split: 'longmemeval',
    category: isAbstentionItem(raw)
      ? 'abstention'
      : (CATEGORY[raw.question_type] ?? 'cross_session_recall'),
    // Every item has its own haystack, so its own "persona".
    persona: `lme-${raw.question_id}`,
    setup_sessions: sessions,
    question: raw.question,
    asked_at: parseLmeDate(raw.question_date),
    valid_at: null,
    known_at: null,
    expected: String(raw.answer),
    judge: 'llm',
    notes: `lme:${raw.question_type}`,
  };
}

/**
 * A seeded subset of about `n` items, stratified: each stratum gets
 * round(n × its share), at least one, so no question type is dropped (§13.6).
 */
export function selectSubset<T extends Pick<RawItem, 'question_id' | 'question_type'>>(
  items: readonly T[],
  n: number,
  seed: number,
): T[] {
  const by = new Map<string, T[]>();
  for (const it of items) {
    const key = stratum(it);
    by.set(key, [...(by.get(key) ?? []), it]);
  }
  const random = rng(seed);
  const out: T[] = [];
  for (const key of [...by.keys()].sort()) {
    const pool = [...(by.get(key) ?? [])].sort((a, b) =>
      a.question_id.localeCompare(b.question_id),
    );
    // Fisher-Yates with the seeded generator.
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [pool[i], pool[j]] = [pool[j] as T, pool[i] as T];
    }
    out.push(...pool.slice(0, Math.max(1, Math.round((n * pool.length) / items.length))));
  }
  return out.sort((a, b) => a.question_id.localeCompare(b.question_id));
}
