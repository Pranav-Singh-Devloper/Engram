// Fixed-window counters for the web demo's limits (P09a, ADR-019). Each bump
// is one atomic upsert, so concurrent requests never lose a count. A request
// that is refused still counts; that keeps the check to one statement.
import type { Queryable } from './client.js';

/** The UTC hour or day a moment falls in. */
export function windowStart(now: Date, size: 'hour' | 'day'): Date {
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  if (size === 'day') d.setUTCHours(0);
  return d;
}

/** Adds one to a (bucket, key) counter for the window and returns the new count. */
export async function bumpThrottle(
  db: Queryable,
  bucket: string,
  key: string,
  window: Date,
): Promise<number> {
  const [row] = await db<{ count: number }[]>`
    insert into throttles (bucket, key, window_start, count)
    values (${bucket}, ${key}, ${window}, 1)
    on conflict (bucket, key, window_start) do update set count = throttles.count + 1
    returning count`;
  return row?.count ?? 0;
}

/** Adds one to a namespace's counter in rate_limits (SPEC §11) and returns the new count. */
export async function bumpNamespaceRate(
  db: Queryable,
  namespaceId: string,
  window: Date,
): Promise<number> {
  const [row] = await db<{ count: number }[]>`
    insert into rate_limits (namespace_id, window_start, count)
    values (${namespaceId}, ${window}, 1)
    on conflict (namespace_id, window_start) do update set count = rate_limits.count + 1
    returning count`;
  return row?.count ?? 0;
}

/** Deletes counter windows older than two days from both tables. */
export async function pruneThrottles(db: Queryable, now: Date): Promise<number> {
  const before = new Date(now.getTime() - 2 * 86_400_000);
  const a = await db`delete from throttles where window_start < ${before}`;
  const b = await db`delete from rate_limits where window_start < ${before}`;
  return a.count + b.count;
}
