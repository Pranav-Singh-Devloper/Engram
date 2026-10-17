// forget (SPEC §9.3): archive (reversible), retract (the belief was wrong), or
// an irreversible hard purge that needs an explicit flag.
import { systemClock } from '../config/clock.js';
import type { Clock } from '../config/clock.js';
import { transaction } from '../db/client.js';
import type { Sql, TransactionSql } from '../db/client.js';
import { insertFactRevision } from '../db/factRevisions.js';
import { invalidateFact } from '../db/facts.js';
import { lockNamespace } from '../resolve/lock.js';
import type { RevisionKind } from '../types/index.js';
import { purgeFacts } from './purge.js';
import type { PurgeReport } from './purge.js';

export type ForgetMode = 'archive' | 'retract' | 'hard';

export interface ForgetTarget {
  namespaceId: string;
  /** One fact; or all of an entity's facts, optionally for one predicate. */
  factId?: string;
  entityId?: string;
  predicate?: string;
}

export interface ForgetOptions extends ForgetTarget {
  mode: ForgetMode;
  /** Required for `hard`: the purge can't be undone. */
  confirmHard?: boolean;
  reason?: string;
}

export interface ForgetResult {
  mode: ForgetMode;
  factIds: string[];
  purge?: PurgeReport;
}

export class ForgetError extends Error {
  override name = 'ForgetError';
}

/** Current beliefs matching the target. */
async function targets(tx: TransactionSql, t: ForgetTarget): Promise<string[]> {
  if (!t.factId && !t.entityId) throw new ForgetError('Give a fact id or an entity id.');
  const rows = await tx<{ id: string }[]>`
    select id from facts
    where namespace_id = ${t.namespaceId} and invalidated_at is null
      ${t.factId ? tx`and id = ${t.factId}` : tx``}
      ${t.entityId ? tx`and subject_id = ${t.entityId}` : tx``}
      ${t.predicate ? tx`and predicate = ${t.predicate}` : tx``}
    order by valid_from, statement`;
  if (rows.length === 0)
    throw new ForgetError('Nothing matches: no current belief for that target.');
  return rows.map((r) => r.id);
}

function log(
  tx: TransactionSql,
  namespaceId: string,
  id: string,
  kind: RevisionKind,
  reason: string,
  at: Date,
) {
  return insertFactRevision(tx, {
    namespaceId,
    oldFactId: id,
    newFactId: kind === 'retraction' ? null : id,
    kind,
    resolver: 'manual',
    reason,
    createdAt: at,
  });
}

export async function forget(
  db: Sql,
  options: ForgetOptions,
  clock: Clock = systemClock,
): Promise<ForgetResult> {
  if (options.mode === 'hard' && options.confirmHard !== true) {
    throw new ForgetError('A hard purge is irreversible; pass confirmHard: true.');
  }
  return transaction(db, async (tx) => {
    await lockNamespace(tx, options.namespaceId);
    const ids = await targets(tx, options);
    const t = clock.now();
    const reason = options.reason ?? `forgotten by request (${options.mode})`;
    switch (options.mode) {
      case 'archive':
        for (const id of ids) {
          const [changed] =
            await tx`update facts set tier = 'archived' where id = ${id} and tier <> 'archived' returning id`;
          if (changed) await log(tx, options.namespaceId, id, 'archive', reason, t);
        }
        return { mode: 'archive', factIds: ids };
      case 'retract':
        for (const id of ids) {
          await invalidateFact(tx, id, { at: t, status: 'retracted' });
          await log(tx, options.namespaceId, id, 'retraction', reason, t);
        }
        return { mode: 'retract', factIds: ids };
      case 'hard':
        return {
          mode: 'hard',
          factIds: ids,
          purge: await purgeFacts(tx, options.namespaceId, ids),
        };
    }
  });
}

/** Undoes an archive: the fact returns to `working`. */
export async function restore(
  db: Sql,
  target: { namespaceId: string; factId: string },
  clock: Clock = systemClock,
): Promise<void> {
  await transaction(db, async (tx) => {
    await lockNamespace(tx, target.namespaceId);
    const [row] = await tx`
      update facts set tier = 'working'
      where id = ${target.factId} and namespace_id = ${target.namespaceId} and tier = 'archived'
      returning id`;
    if (!row) throw new ForgetError('That fact is not archived.');
    await log(tx, target.namespaceId, target.factId, 'restore', 'restored by request', clock.now());
  });
}
