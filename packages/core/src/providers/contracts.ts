// I/O contracts for every LLM-backed provider method (SPEC §14). Fake and
// Gemini implementations share these, and every output is parsed through
// them before the engine sees it. Phases refine a contract when they write
// its prompt (P02 extraction, P03 adjudication, P05 composition,
// P06b summaries); keep changes here, not in the implementations.
//
// Model-facing fields are nullable rather than optional: structured-output
// modes handle "always present, maybe null" more reliably than missing keys.
import { z } from 'zod';
import { ENTITY_TYPES, EPISODE_ROLES } from '../types/index.js';

const unit = z.number().min(0).max(1);

/** Name used by the model for the user; code maps it to the `is_self` entity. */
export const SELF_REF = 'SELF';

export const EmbedPurpose = z.enum(['document', 'query']);
export type EmbedPurpose = z.infer<typeof EmbedPurpose>;

/**
 * When a fact starts or ends, as the model read it. Code resolves hints
 * against the episode's `occurred_at`; the model never does date arithmetic.
 */
export const TemporalHint = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('absolute'), date: z.iso.date() }),
  z.object({
    kind: z.literal('relative'),
    amount: z.number().int().min(0),
    unit: z.enum(['day', 'week', 'month', 'year']),
    direction: z.enum(['ago', 'from_now']),
  }),
  z.object({
    kind: z.literal('named_period'),
    year: z.number().int().nullable(),
    month: z.number().int().min(1).max(12).nullable(),
    season: z.enum(['spring', 'summer', 'autumn', 'winter']).nullable(),
  }),
]);
export type TemporalHint = z.infer<typeof TemporalHint>;

export const EntityRef = z.object({
  name: z.string().min(1),
  type: z.enum(ENTITY_TYPES).nullable(),
  description: z.string().nullable(),
});
export type EntityRef = z.infer<typeof EntityRef>;

export const ObjectRef = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('entity'), entity: EntityRef }),
  z.object({ kind: z.literal('literal'), value: z.string().min(1) }),
]);
export type ObjectRef = z.infer<typeof ObjectRef>;

export const FactCandidate = z.object({
  subject: EntityRef,
  predicate: z.string().min(1),
  object: ObjectRef,
  statement: z.string().min(1),
  validFrom: TemporalHint,
  validTo: TemporalHint,
  isCorrection: z.boolean(),
  confidence: unit,
});
export type FactCandidate = z.infer<typeof FactCandidate>;

export const ProcessEpisodeInput = z.object({
  content: z.string().min(1),
  role: z.enum(EPISODE_ROLES),
  occurredAt: z.date(),
  /** Registry predicate names the model should prefer (SPEC §7.1). */
  predicates: z.array(z.string()),
});
export const ProcessEpisodeOutput = z.object({
  importance: unit,
  candidates: z.array(FactCandidate),
});

const EntityChoice = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(ENTITY_TYPES).nullable(),
  description: z.string().nullable(),
  aliases: z.array(z.string()),
});
export const DisambiguateInput = z.object({
  mention: EntityRef,
  /** The episode text the mention came from. */
  context: z.string(),
  candidates: z.array(EntityChoice).min(2),
});
export const DisambiguateOutput = z.object({
  /** One of the candidate ids, or null for a new entity. */
  entityId: z.string().nullable(),
  reason: z.string(),
});

const FactSummary = z.object({
  id: z.string(),
  statement: z.string(),
  validFrom: z.date(),
  validTo: z.date().nullable(),
  confidence: unit,
});
export const AdjudicateInput = z.object({
  predicate: z.string(),
  cardinality: z.enum(['one', 'many']),
  mutability: z.enum(['static', 'dynamic']),
  candidate: FactSummary.omit({ id: true }).extend({ isCorrection: z.boolean() }),
  existing: z.array(FactSummary).min(1),
});
export const AdjudicateOutput = z.object({
  decision: z.enum(['update', 'correction', 'coexist', 'reject']),
  /** The existing fact the decision applies to; null for coexist and reject. */
  targetFactId: z.string().nullable(),
  reason: z.string(),
  /** True when the predicate's cardinality looks wrong, e.g. two concurrent jobs. */
  flagPredicate: z.boolean(),
});

export const SummarizeInput = z.object({
  episodes: z
    .array(
      z.object({
        id: z.string(),
        role: z.enum(EPISODE_ROLES),
        content: z.string(),
        occurredAt: z.date(),
      }),
    )
    .min(1),
});
export const SummarizeOutput = z.object({
  summary: z.string().min(1),
  candidates: z.array(FactCandidate),
});

export const ComposeInput = z.object({
  question: z.string().min(1),
  now: z.date(),
  /** Untrusted data, never instructions (SPEC §6.3). */
  memories: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['fact', 'episode']),
      text: z.string(),
      validFrom: z.date().nullable(),
      validTo: z.date().nullable(),
    }),
  ),
});
export const ComposeOutput = z.object({
  answer: z.string(),
  supported: z.boolean(),
  usedMemoryIds: z.array(z.string()),
});

export const JudgeInput = z.object({
  question: z.string(),
  expected: z.string(),
  answer: z.string(),
});
export const JudgeOutput = z.object({
  correct: z.boolean(),
  reason: z.string(),
});

/** Every structured method, keyed by name, so implementations can be generic. */
export const CONTRACTS = {
  processEpisode: { input: ProcessEpisodeInput, output: ProcessEpisodeOutput },
  disambiguate: { input: DisambiguateInput, output: DisambiguateOutput },
  adjudicate: { input: AdjudicateInput, output: AdjudicateOutput },
  summarize: { input: SummarizeInput, output: SummarizeOutput },
  compose: { input: ComposeInput, output: ComposeOutput },
  judge: { input: JudgeInput, output: JudgeOutput },
} as const;

export type StructuredMethod = keyof typeof CONTRACTS;
export type MethodInput<M extends StructuredMethod> = z.input<(typeof CONTRACTS)[M]['input']>;
export type MethodOutput<M extends StructuredMethod> = z.output<(typeof CONTRACTS)[M]['output']>;
