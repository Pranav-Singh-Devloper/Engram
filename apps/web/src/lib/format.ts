// Display helpers shared by the pages. Client code must not import
// @engram/core (it would bundle Postgres), so the one engine constant needed
// here is mirrored, and format.test.ts asserts it still equals core's.

/** Core's config.decay.archiveThreshold: decay archives a fact whose retention falls below it. */
export const ARCHIVE_THRESHOLD = 0.15;

/** Core's UNKNOWN_START: a fact whose start the conversation never gave. */
export const UNKNOWN_START_MS = -8.64e15;

const month = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const day = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export function isUnknownStart(d: Date): boolean {
  return d.getTime() <= UNKNOWN_START_MS;
}

/** "Mar 2024 → now", "unknown → 2018", "15 Jan 2024". Month precision unless `exact`. */
export function formatWindow(from: Date, to: Date | null, exact = false): string {
  const f = exact ? day : month;
  const start = isUnknownStart(from) ? 'unknown' : f.format(from);
  return `${start} → ${to ? f.format(to) : 'now'}`;
}

export function formatDay(d: Date): string {
  return day.format(d);
}

export const pct = (x: number) => `${Math.round(100 * x)}%`;
