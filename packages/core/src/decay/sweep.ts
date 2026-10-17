// The decay sweep (SPEC §9.2), run by pg_cron when hosted and directly, with
// a simulated `now`, in tests. Parameters come from `config` and the registry.
import { config } from '../config/index.js';
import { PREDICATES } from '../conflict/predicates.js';
import type { Queryable } from '../db/client.js';
import { maybeOne, one } from '../db/rows.js';
import { textArray } from '../db/client.js';

/** Predicates decay never archives: facts that don't go stale (SPEC §9.2). */
export const STATIC_PREDICATES = PREDICATES.filter((p) => p.mutability === 'static').map(
  (p) => p.name,
);

export interface SweepOptions {
  now: Date;
  /** Sweep one namespace; all of them when omitted. */
  namespaceId?: string;
}

export async function decaySweep(
  db: Queryable,
  options: SweepOptions,
  cfg: typeof config.decay = config.decay,
): Promise<{ archived: number }> {
  const row = one(
    await db<{ archived: number }[]>`
      select engram.engram_decay_sweep(
        ${options.now}::timestamptz,
        ${cfg.tauWorkingDays}::double precision,
        ${cfg.tauLongTermDays}::double precision,
        ${cfg.archiveThreshold}::double precision,
        ${cfg.recencyWeight}::double precision,
        ${cfg.accessWeight}::double precision,
        ${cfg.importanceWeight}::double precision,
        ${cfg.accessSaturation}::double precision,
        ${textArray(db, STATIC_PREDICATES)}::text[],
        ${options.namespaceId ?? null}::uuid
      ) as archived`,
  );
  return { archived: row.archived };
}

/** When decay last ran over a namespace (or over all of them). */
export async function lastSweep(db: Queryable, namespaceId?: string): Promise<Date | null> {
  const row = maybeOne(
    await db<{ ranAt: Date | null }[]>`
      select max(ran_at) as ran_at from decay_sweeps
      where namespace_id is null or namespace_id = ${namespaceId ?? null}::uuid`,
  );
  return row?.ranAt ?? null;
}
