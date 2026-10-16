// An entity's fact timeline (SPEC §7.3): every row ordered by valid time,
// each with its record window. By default it shows what the system has held
// as a belief at some point and not replaced with a newer version: current
// beliefs, closed history and retractions. `includeRevised` adds the
// replaced versions, which is the record-time audit view. "Replaced" is
// read from lineage (another row revises it), not from the status label.
import type { Queryable } from '../db/client.js';
import { parseFact } from '../db/factRows.js';
import type { FactRow } from '../db/factRows.js';
import type { Fact } from '../types/index.js';

export interface HistoryEntry {
  fact: Fact;
  /** The object entity's name, or the literal. */
  objectName: string;
  /** A newer version of this row exists. */
  replaced: boolean;
}

export interface HistoryOptions {
  predicate?: string;
  includeRevised?: boolean;
}

export async function history(
  db: Queryable,
  entityId: string,
  options: HistoryOptions = {},
): Promise<HistoryEntry[]> {
  const rows = await db<(FactRow & { objectName: string; replaced: boolean })[]>`
    select f.*, coalesce(o.name, f.object_literal) as object_name,
           exists (select 1 from facts n where n.revises = f.id) as replaced
    from facts f left join entities o on o.id = f.object_id
    where f.subject_id = ${entityId}
      ${options.predicate ? db`and f.predicate = ${options.predicate}` : db``}
      ${options.includeRevised ? db`` : db`and not exists (select 1 from facts n where n.revises = f.id)`}
    order by f.predicate, f.valid_from, f.recorded_at, f.id`;
  return rows.map(({ objectName, replaced, ...row }) => ({
    fact: parseFact(row),
    objectName,
    replaced,
  }));
}
