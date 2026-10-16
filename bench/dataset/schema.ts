// The Engram-Bench item format (SPEC §13.1), snake_case as in the spec, plus
// `persona` (items about the same history share it, and so share cached
// extraction) and `asked_at` (the "now" the question is asked at).
import { z } from 'zod';

export const CATEGORIES = [
  'cross_session_recall',
  'knowledge_update',
  'temporal_reasoning',
  'single_session_recall',
  'multi_hop',
  'abstention',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const JUDGES = ['exact', 'contains', 'llm'] as const;
export type JudgeKind = (typeof JUDGES)[number];

export const SetupSession = z.object({
  session_id: z.string().min(1),
  occurred_at: z.iso.datetime(),
  /** User turns, a minute apart from `occurred_at` (decision 8 in the P04 plan). */
  turns: z.array(z.string().min(1)).min(1),
});
export type SetupSession = z.infer<typeof SetupSession>;

export const BenchItem = z.object({
  id: z.string().min(1),
  split: z.enum(['dev', 'test']),
  category: z.enum(CATEGORIES),
  persona: z.string().min(1),
  setup_sessions: z.array(SetupSession).min(1),
  question: z.string().min(1),
  asked_at: z.iso.datetime(),
  valid_at: z.iso.datetime().nullable(),
  known_at: z.iso.datetime().nullable(),
  expected: z.string().min(1),
  judge: z.enum(JUDGES),
  notes: z.string(),
});
export type BenchItem = z.infer<typeof BenchItem>;

export const SplitFile = z.object({
  split: z.enum(['dev', 'test']),
  seed: z.number().int(),
  generated_at: z.iso.datetime(),
  /** Models that verbalized the turns; the ground truth itself is code. */
  verbalizer: z.string(),
  /** What the human review pass checked and changed. */
  review: z.string().optional(),
  items: z.array(BenchItem).min(1),
});
export type SplitFile = z.infer<typeof SplitFile>;

/** Each turn is said one minute after the previous one in its session. */
export function turnTime(session: SetupSession, index: number): Date {
  return new Date(new Date(session.occurred_at).getTime() + index * 60_000);
}
