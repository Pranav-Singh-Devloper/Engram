// The seam between extraction and conflict resolution (SPEC §6.1 step 3).
// The default implementation is `createConflictResolver` (SPEC §7.2).
import type { Clock } from '../config/clock.js';
import type { Sql } from '../db/client.js';
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
  /** The object entity's name, or the literal; used to compare objects. */
  objectName: string;
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
  /** `clock` supplies record time, read inside the resolver's lock. */
  resolve(db: Sql, candidate: ResolvedCandidate, ctx: { clock: Clock }): Promise<Resolution>;
}
