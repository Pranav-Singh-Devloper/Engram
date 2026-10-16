import { fromSql } from './vector.js';
import type { Fact } from '../types/index.js';

/** A fact as postgres.js returns it: the embedding is pgvector text. */
export type FactRow = Omit<Fact, 'embedding'> & { embedding: string | null };

export function parseFact(row: FactRow): Fact {
  return { ...row, embedding: row.embedding === null ? null : fromSql(row.embedding) };
}
