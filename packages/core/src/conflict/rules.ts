// The rule fast-path for resolving a candidate against current beliefs
// (SPEC §7.2). Pure: given the candidate, the current-belief rows for its
// (subject, predicate) and the predicate's registry entry, it returns a
// decision, or `adjudicate` when no rule applies. `apply.ts` turns decisions
// into row writes.
//
// Order: merge, then (single-valued predicates) correction cue, noise, static
// handling, backfill, update. The cue and noise come before update so that
// "Actually I work at Acme, not Initech" retracts Initech instead of
// closing it as if the user had changed jobs.
import { config } from '../config/index.js';
import { cosine } from '../db/vector.js';
import { normalizeName } from '../extract/normalize.js';
import type { Fact, ValidFromSource } from '../types/index.js';
import type { PredicateSpec } from './predicates.js';

/** A current-belief row with its object's label: the entity's name, or the literal. */
export type Belief = Fact & { objectName: string };

/** What classification needs to know about a candidate. */
export interface CandidateView {
  objectId: string | null;
  objectLiteral: string | null;
  /** The entity's name, or the literal. */
  objectName: string;
  /** Statement embedding. */
  embedding: readonly number[];
  validFrom: Date;
  validFromSource: ValidFromSource;
  validTo: Date | null;
  isCorrection: boolean;
  confidence: number;
}

export type AdjudicationChoice = 'update' | 'correction' | 'coexist' | 'reject';

type Via = { resolver: 'rule' | 'llm'; reason: string };

export type Decision =
  | ({ kind: 'insert' } & Via)
  | ({ kind: 'merge'; target: Fact } & Via)
  | ({ kind: 'coexist' } & Via)
  | ({ kind: 'update'; target: Fact } & Via)
  | ({ kind: 'backfill'; successor: Fact; validTo: Date } & Via)
  | ({ kind: 'correction'; target: Fact } & Via)
  | ({ kind: 'reject'; target: Fact | null } & Via)
  | { kind: 'adjudicate'; reason: string; allowed: AdjudicationChoice[] };

export type ResolvedDecision = Exclude<Decision, { kind: 'adjudicate' }>;

interface Window {
  from: Date;
  to: Date | null;
}

const ALL_CHOICES: AdjudicationChoice[] = ['update', 'correction', 'coexist', 'reject'];

export function overlaps(a: Window, b: Window): boolean {
  const aEnd = a.to?.getTime() ?? Infinity;
  const bEnd = b.to?.getTime() ?? Infinity;
  return a.from.getTime() < bEnd && b.from.getTime() < aEnd;
}

export function adjacent(a: Window, b: Window): boolean {
  return a.to?.getTime() === b.from.getTime() || b.to?.getTime() === a.from.getTime();
}

const windowOf = (f: { validFrom: Date; validTo: Date | null }): Window => ({
  from: f.validFrom,
  to: f.validTo,
});

/**
 * The same object: the same entity; otherwise the same label, so a literal
 * "Toronto" and the entity Toronto match; otherwise, for two literals, a
 * statement similar enough to be a paraphrase. Two different entities never
 * match by embedding: "lives in Bern" and "lives in Berlin" read alike.
 */
export function sameObject(c: CandidateView, e: Belief, mergeThreshold: number): boolean {
  if (c.objectId !== null && e.objectId !== null) return c.objectId === e.objectId;
  if (normalizeName(c.objectName) === normalizeName(e.objectName)) return true;
  if (c.objectLiteral === null || e.objectLiteral === null) return false;
  return e.embedding !== null && cosine(c.embedding, e.embedding) >= mergeThreshold;
}

export function classify(
  c: CandidateView,
  existing: readonly Belief[],
  spec: PredicateSpec | undefined,
  cfg: typeof config.conflict = config.conflict,
): Decision {
  // Ad-hoc predicates are treated as multi-valued and dynamic: unknown
  // relations coexist rather than wrongly superseding each other.
  const cardinality = spec?.cardinality ?? 'many';
  const mutability = spec?.mutability ?? 'dynamic';
  const rule = (reason: string) => ({ resolver: 'rule' as const, reason });

  if (existing.length === 0) return { kind: 'insert', ...rule('no current beliefs') };

  const win = windowOf(c);
  const twin = existing.find(
    (e) =>
      sameObject(c, e, cfg.mergeThreshold) &&
      (overlaps(win, windowOf(e)) || adjacent(win, windowOf(e))),
  );
  if (twin) return { kind: 'merge', target: twin, ...rule('same object, overlapping window') };

  if (cardinality === 'many') {
    if (c.isCorrection) {
      return {
        kind: 'adjudicate',
        reason: 'correction cue on a multi-valued predicate',
        allowed: ALL_CHOICES,
      };
    }
    return { kind: 'coexist', ...rule('multi-valued predicate') };
  }

  const open = existing.find((e) => e.validTo === null);
  const byStart = [...existing].sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime());

  if (c.isCorrection) {
    const target =
      existing.find((e) => overlaps(win, windowOf(e))) ?? open ?? byStart[byStart.length - 1];
    if (target) return { kind: 'correction', target, ...rule('correction cue') };
  }

  // An open-ended dynamic candidate that starts before known history ends
  // where the next known row begins: "Lyon from 2015", learned after Berlin.
  const later = byStart.filter((e) => e.validFrom.getTime() > c.validFrom.getTime());
  const successor = later[0];
  const effTo =
    mutability === 'dynamic' && c.validTo === null && successor ? successor.validFrom : c.validTo;
  const conflicting = existing.filter((e) =>
    overlaps({ from: c.validFrom, to: effTo }, windowOf(e)),
  );

  const strong = conflicting.find((e) => e.confidence >= cfg.noiseExistingMin);
  if (c.confidence < cfg.noiseCandidateMax && strong) {
    return {
      kind: 'reject',
      target: strong,
      ...rule('low-confidence candidate against a confident fact'),
    };
  }

  if (mutability === 'static') {
    if (conflicting.length === 0) return { kind: 'insert', ...rule('no overlapping belief') };
    return {
      kind: 'adjudicate',
      reason: 'contradiction on a static predicate',
      allowed: ['correction', 'reject'],
    };
  }

  if (conflicting.length === 0) {
    if (successor && effTo) {
      return {
        kind: 'backfill',
        successor,
        validTo: effTo,
        ...rule('entirely before known history'),
      };
    }
    return { kind: 'insert', ...rule('no overlapping belief') };
  }

  const [only] = conflicting;
  if (
    only !== undefined &&
    conflicting.length === 1 &&
    only === open &&
    c.validTo === null &&
    c.validFrom.getTime() > only.validFrom.getTime()
  ) {
    return { kind: 'update', target: only, ...rule('new value after the open one started') };
  }

  return {
    kind: 'adjudicate',
    reason: conflicting.some((e) => e.validTo !== null)
      ? 'overlaps closed history'
      : 'ambiguous overlap with the current value',
    allowed: ALL_CHOICES,
  };
}

/** Turns the adjudicator's answer into a decision the row mechanics can apply. */
export function fromAdjudication(
  out: {
    decision: AdjudicationChoice;
    targetFactId: string | null;
    reason: string;
    flagPredicate: boolean;
  },
  c: CandidateView,
  existing: readonly Belief[],
  allowed: readonly AdjudicationChoice[],
): ResolvedDecision {
  const llm = (reason: string) => ({ resolver: 'llm' as const, reason });
  const reason = out.flagPredicate ? `${out.reason} [predicate flagged for review]` : out.reason;
  const target =
    existing.find((e) => e.id === out.targetFactId) ??
    existing.find((e) => overlaps(windowOf(c), windowOf(e))) ??
    existing.find((e) => e.validTo === null) ??
    null;

  if (!allowed.includes(out.decision)) {
    return { kind: 'reject', target, ...llm(`${out.decision} isn't allowed here: ${reason}`) };
  }
  switch (out.decision) {
    case 'update':
      // Only an open row can be closed at the candidate's start.
      if (target?.validTo === null && c.validFrom.getTime() > target.validFrom.getTime()) {
        return { kind: 'update', target, ...llm(reason) };
      }
      return { kind: 'coexist', ...llm(`update not applicable, kept both: ${reason}`) };
    case 'correction':
      return target
        ? { kind: 'correction', target, ...llm(reason) }
        : { kind: 'insert', ...llm(`nothing to correct: ${reason}`) };
    case 'coexist':
      return { kind: 'coexist', ...llm(reason) };
    case 'reject':
      return { kind: 'reject', target, ...llm(reason) };
  }
}
