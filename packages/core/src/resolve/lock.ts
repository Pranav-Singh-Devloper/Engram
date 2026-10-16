import type { TransactionSql } from '../db/client.js';

/**
 * Serializes writers within one namespace for the rest of the transaction.
 * Transaction-scoped, so it's safe behind Supabase's transaction pooler
 * (SPEC §6.1). Never make an LLM call while holding it. Key collisions across
 * namespaces only cost extra serialization.
 */
export async function lockNamespace(tx: TransactionSql, namespaceId: string): Promise<void> {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`engram:ns:${namespaceId}`}, 0))`;
}
