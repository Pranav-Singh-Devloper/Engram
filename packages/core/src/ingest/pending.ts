// Catch-up for episodes stored but never processed (SPEC §6.1): a client that
// exited during `wait: false` processing, or a crash. Oldest first, one at a
// time; it stops at the first failure so an exhausted quota isn't hammered.
import { systemClock } from '../config/clock.js';
import type { Clock } from '../config/clock.js';
import type { Sql } from '../db/client.js';
import type { Provider } from '../providers/provider.js';
import { processEpisode } from './process.js';

export interface PendingOptions {
  namespaceId?: string;
  /** At most this many episodes per call. */
  limit?: number;
  clock?: Clock;
}

export interface PendingResult {
  processed: number;
  /** Unprocessed episodes left after this call. */
  remaining: number;
  /** The failure that stopped the run, if any. */
  error: string | null;
}

export async function processPending(
  db: Sql,
  provider: Provider,
  options: PendingOptions = {},
): Promise<PendingResult> {
  const scope = options.namespaceId ? db`and namespace_id = ${options.namespaceId}` : db``;
  const rows = await db<{ id: string }[]>`
    select id from episodes where processed_at is null ${scope}
    order by occurred_at, created_at, id
    limit ${options.limit ?? 50}`;
  let processed = 0;
  let error: string | null = null;
  for (const { id } of rows) {
    try {
      await processEpisode(db, provider, id, { clock: options.clock ?? systemClock });
      processed++;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      break;
    }
  }
  const [left] = await db<{ n: number }[]>`
    select count(*)::int as n from episodes where processed_at is null ${scope}`;
  return { processed, remaining: left?.n ?? 0, error };
}
