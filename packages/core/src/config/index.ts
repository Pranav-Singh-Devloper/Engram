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
    /**
     * A lone name or alias match whose label is less similar than this has a
     * conflicting description (two different Sams), so it goes to
     * disambiguation instead of merging. Tuned on dev.
     */
    descriptionConflictThreshold: 0.95,
    /** Attempts before giving up when concurrent writers keep changing the candidates. */
    maxResolveAttempts: 3,
  },
  conflict: {
    /** Statement similarity for a merge. Tuned on dev. */
    mergeThreshold: 0.9,
    /** Reject a candidate below this confidence when the existing fact is at or above `noiseExistingMin`. */
    noiseCandidateMax: 0.4,
    noiseExistingMin: 0.8,
    /** Attempts before giving up when concurrent writers keep changing the beliefs. */
    maxResolveAttempts: 3,
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
    graphLimit: 20,
    /** 'rrf' or the min-max weighted-linear alternative. Chosen on dev (ADR). */
    ranker: 'rrf' as 'rrf' | 'linear',
    /** Weighted-linear ranker: normalized similarity, normalized text rank, recency, importance. */
    linearWeights: { similarity: 0.7, text: 0.2, recency: 0.05, importance: 0.05 },
    /** Below this best raw cosine, recall returns nothing. Tuned on dev. */
    floor: 0.5,
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
