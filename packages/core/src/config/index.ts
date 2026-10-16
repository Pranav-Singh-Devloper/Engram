// Engine parameters. This file is the source of truth: SQL functions (decay)
// receive these as arguments rather than hard-coding them (SPEC §9.2).
// Thresholds marked "tuned on dev" start as the spec's guesses and are
// adjusted only against the dev split (SPEC §13.1).

/** Embedding dimension of every vector column. Changing it is a migration plus an ADR. */
export const EMBEDDING_DIM = 768;

export const config = {
  extraction: {
    /** Tool output (web pages, file contents) never plants facts by default (SPEC §6.1). */
    extractFromToolOutput: false,
  },
  entities: {
    /** Cosine similarity on "name (type): description" to match an existing entity. */
    matchThreshold: 0.85,
  },
  conflict: {
    /** Statement similarity for a merge. Tuned on dev. */
    mergeThreshold: 0.9,
    /** Reject a candidate below this confidence when the existing fact is at or above `noiseExistingMin`. */
    noiseCandidateMax: 0.4,
    noiseExistingMin: 0.8,
  },
  recall: {
    k: 8,
    factCandidates: 40,
    episodeCandidates: 20,
    ftsCandidates: 20,
    graphSeeds: 10,
    rrfK: 60,
    recencyWeight: 0.1,
    importanceWeight: 0.1,
    /** Recency prior is exp(−age / recencyScaleDays). */
    recencyScaleDays: 30,
  },
  decay: {
    tauWorkingDays: 14,
    tauLongTermDays: 90,
    archiveThreshold: 0.15,
    recencyWeight: 0.5,
    accessWeight: 0.25,
    importanceWeight: 0.25,
    /** Access term is min(1, ln(1 + access_score) / ln(1 + accessSaturation)). */
    accessSaturation: 20,
  },
} as const;

export type EngramConfig = typeof config;
