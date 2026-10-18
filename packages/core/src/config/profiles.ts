// Similarity thresholds per embedding model (P08b decision 6, ADR-017).
// Cosine scales differ between embedders (embeddinggemma scores related
// labels ~0.15 lower than gemini-embedding-2), so a threshold tuned on one is
// wrong for another. Each profile comes from `pnpm bench:calibrate` on the
// labelled dev pair set; ADR-017 records the data behind every value.
import { ProviderError } from '../providers/provider.js';
import { config } from './index.js';

export interface SimilarityProfile {
  /** Two entity labels are the same entity at ≥ this (the embedding rung). */
  entityMatch: number;
  /** A same-name person whose label scores below this goes to disambiguation. */
  descriptionConflict: number;
  /** A literal paraphrase of an existing fact merges at ≥ this. */
  merge: number;
  /** Entity search lists labels scoring ≥ this. */
  entitySearch: number;
  /** Consolidation splits a session where consecutive turns score below this. */
  drift: number;
  /** Recall abstains when nothing scores ≥ this. */
  recallFloor: number;
}

/** gemini-embedding-2: the values tuned in P03-P07 (also used by the fake provider). */
const GEMINI: SimilarityProfile = {
  entityMatch: config.entities.matchThreshold,
  descriptionConflict: config.entities.descriptionConflictThreshold,
  merge: config.conflict.mergeThreshold,
  entitySearch: config.entities.searchMinSimilarity,
  drift: config.consolidation.driftThreshold,
  recallFloor: config.recall.floor,
};

export const SIMILARITY_PROFILES: Readonly<Record<string, SimilarityProfile>> = {
  'gemini-embedding-2': GEMINI,
  fake: GEMINI,
  // Calibrated 2026-10-18 on 537 labelled dev pairs (bench/calibration/embeddinggemma_*.json).
  'embeddinggemma:300m': {
    entityMatch: 0.775, // same 0.789–0.865, different 0.584–0.757: the gap's middle
    descriptionConflict: 0.848, // above every different-person pair (max 0.847); lower same-person pairs go to disambiguation
    merge: 0.9, // paraphrases ≥ 0.95, different values ≤ 0.81
    entitySearch: 0.335, // related 0.435–0.616, unrelated ≤ 0.236
    drift: 0.25, // below the 5th percentile of consecutive same-session turns (0.288)
    recallFloor: 0.3, // provisional until the dev-long floor simulation (P08b task 9)
  },
};

/** The profile for an embedding space ("model" or "model@digest"). Unknown models fail loudly. */
export function profileForSpace(space: string): SimilarityProfile {
  const model = space.split('@')[0] ?? space;
  const profile = SIMILARITY_PROFILES[model];
  if (!profile) {
    throw new ProviderError(
      `No similarity profile for the embedding model ${model}. Its similarity scale differs from the calibrated ones; run \`pnpm bench:calibrate --embedder=local\` with it and add a profile (ADR-017).`,
    );
  }
  return profile;
}

/** The profile for a provider's embeddings. */
export async function similarityProfile(provider: {
  embeddingSpace(): Promise<string>;
}): Promise<SimilarityProfile> {
  return profileForSpace(await provider.embeddingSpace());
}
