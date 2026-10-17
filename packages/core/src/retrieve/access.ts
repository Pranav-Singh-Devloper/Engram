// Access tracking (SPEC §6.2 step 7): one batched write for the memories a
// caller actually used. `access_score += 1`, `last_accessed_at = now`, and an
// archived hit returns to `working` with a `restore` revision. Callers decide
// what "used" means: the composer's ids in chat, every returned memory over
// MCP, nothing for dashboard browsing.
import type { Clock } from '../config/clock.js';
import { transaction } from '../db/client.js';
import { insertFactRevision } from '../db/factRevisions.js';
import type { Sql } from '../db/client.js';
import { uuidArray } from '../db/client.js';

export async function trackUse(db: Sql, factIds: readonly string[], clock: Clock): Promise<void> {
  if (factIds.length === 0) return;
  const now = clock.now();
  await transaction(db, async (tx) => {
    const restored = await tx<{ id: string; namespaceId: string }[]>`
      update facts set tier = 'working'
      where id = any(${uuidArray(tx, [...factIds])}::uuid[]) and tier = 'archived' and invalidated_at is null
      returning id, namespace_id`;
    for (const r of restored) {
      await insertFactRevision(tx, {
        namespaceId: r.namespaceId,
        oldFactId: r.id,
        newFactId: r.id,
        kind: 'restore',
        resolver: 'rule',
        reason: 'recalled from the archive',
        createdAt: now,
      });
    }
    await tx`
      update facts set access_score = access_score + 1, last_accessed_at = ${now}
      where id = any(${uuidArray(tx, [...factIds])}::uuid[]) and invalidated_at is null`;
  });
}
