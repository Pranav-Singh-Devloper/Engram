// Calibration (ADR-017): 537 labelled dev pairs per embedder, summarized by
// bench:calibrate. Per-pair scores exist where they were recorded (Gemini);
// embeddinggemma has its summary only (its scores need a local Ollama run).
import raw from '@/content/generated/calibration.json';

export const FAMILY_NAMES = [
  'entityMatch',
  'descriptionConflict',
  'merge',
  'entitySearch',
  'drift',
] as const;
export type Family = (typeof FAMILY_NAMES)[number];

export interface FamilySummary {
  positives: number;
  negatives: number;
  current: { threshold: number; falsePositive: number; falseNegative: number };
  suggested: { threshold: number; falsePositive: number; positivesKept: number };
  positiveRange: [number, number];
  negativeRange: [number, number];
}

export interface Calibration {
  space: string;
  generatedAt: string;
  maxFalse: number;
  pairs: number;
  families: Record<Family, FamilySummary>;
  scores: Record<Family, { positive: number[]; negative: number[] }> | null;
}

export const CALIBRATIONS = raw as unknown as Calibration[];

/** What a positive pair is, and what each error costs the engine (bench/calibration/pairs.ts). */
export const FAMILY_INFO: Record<
  Family,
  { label: string; positive: string; negative: string; fp: string; fn: string }
> = {
  entityMatch: {
    label: 'Entity match',
    positive: 'two labels of one entity',
    negative: 'labels of different entities',
    fp: 'false merge: two things become one entity',
    fn: 'missed match: a duplicate entity (or the next rung decides)',
  },
  descriptionConflict: {
    label: 'Description conflict',
    positive: 'same name, same person',
    negative: 'same name, different people',
    fp: 'two people merged without asking',
    fn: 'sent to LLM disambiguation: safe, costs a call',
  },
  merge: {
    label: 'Fact merge',
    positive: 'a paraphrase of the same fact',
    negative: 'the same predicate, another value',
    fp: 'a different value merged away',
    fn: 'a paraphrase stored twice',
  },
  entitySearch: {
    label: 'Entity search',
    positive: 'a query naming or describing the entity',
    negative: 'an unrelated entity',
    fp: 'noise in search results',
    fn: 'the entity isn’t found',
  },
  drift: {
    label: 'Consolidation drift',
    positive: 'consecutive turns in one session',
    negative: 'the seam between two sessions',
    fp: 'two topics share one summary',
    fn: 'a session split mid-topic',
  },
};

/** Error rates at threshold t: negatives scoring ≥ t, positives scoring < t (calibrate.ts). */
export function errorsAt(s: { positive: number[]; negative: number[] }, t: number) {
  const rate = (xs: number[], f: (x: number) => boolean) =>
    xs.length === 0 ? 0 : xs.filter(f).length / xs.length;
  return {
    falsePositive: rate(s.negative, (x) => x >= t),
    falseNegative: rate(s.positive, (x) => x < t),
  };
}

/** The engine's similarity profiles (core config/profiles.ts; parity test). */
export const PROFILES: Record<string, Record<Family, number> & { recallFloor: number }> = {
  'gemini-embedding-2': {
    entityMatch: 0.85,
    descriptionConflict: 0.95,
    merge: 0.9,
    entitySearch: 0.7,
    drift: 0.5,
    recallFloor: 0.5,
  },
  'embeddinggemma:300m': {
    entityMatch: 0.775,
    descriptionConflict: 0.848,
    merge: 0.9,
    entitySearch: 0.335,
    drift: 0.25,
    recallFloor: 0.25,
  },
};

/** The model name of an embedding space ("model@digest" → "model"). */
export const modelOf = (space: string) => space.split('@')[0] ?? space;
