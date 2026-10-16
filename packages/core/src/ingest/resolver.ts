// The seam between extraction and conflict resolution (SPEC §6.1 step 3).
// P02 ships `insertOnlyResolver`; P03 replaces it with the §7.2 resolver.
import type { Sql } from '../db/client.js';
import { insertFact } from '../db/facts.js';
import type { FactCandidate } from '../providers/contracts.js';
import type { ValidFromSource } from '../types/index.js';

/** A candidate with entities resolved, dates resolved and the statement embedded. */
export interface ResolvedCandidate {
  namespaceId: string;
  subjectId: string;
  predicate: string;
  predicateAdHoc: boolean;
  objectId: string | null;
  objectLiteral: string | null;
  statement: string;
  embedding: number[];
  confidence: number;
  importance: number;
  validFrom: Date;
  validFromSource: ValidFromSource;
  validTo: Date | null;
  isCorrection: boolean;
  sourceEpisodeIds: string[];
  /** What the model returned, kept for revision audits and rejects. */
  raw: FactCandidate;
}

export type ResolutionKind =
  'inserted' | 'merged' | 'updated' | 'backfilled' | 'corrected' | 'coexisted' | 'rejected';

export interface Resolution {
  kind: ResolutionKind;
  /** The fact that now carries the candidate, or null for a reject. */
  factId: string | null;
}

export interface CandidateResolver {
  resolve(db: Sql, candidate: ResolvedCandidate, ctx: { recordedAt: Date }): Promise<Resolution>;
}

/** Inserts every candidate as a new fact. Replaced by conflict resolution in P03. */
export const insertOnlyResolver: CandidateResolver = {
  async resolve(db, candidate, ctx) {
    const { raw: _raw, isCorrection: _isCorrection, ...fact } = candidate;
    const row = await insertFact(db, { ...fact, recordedAt: ctx.recordedAt });
    return { kind: 'inserted', factId: row.id };
  },
};
