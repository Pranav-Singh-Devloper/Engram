// Deterministic text for tool results: ISO times, fixed order, no timings.
import { UNKNOWN_START } from '@engram/core';

/** An instant as ISO 8601 without milliseconds. */
export const iso = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** A window bound for text: `open`/`now` when unbounded, `unknown` for an unknown start. */
export function bound(d: Date | null, unbounded: 'open' | 'now'): string {
  if (d === null) return unbounded;
  if (d.getTime() === UNKNOWN_START.getTime()) return 'unknown';
  // Midnight-UTC bounds are dates (resolved hints); anything else keeps its time.
  return d.getUTCHours() + d.getUTCMinutes() + d.getUTCSeconds() === 0
    ? d.toISOString().slice(0, 10)
    : iso(d);
}

/** The same bound for structured content: ISO, or null when open, or "unknown". */
export function boundJson(d: Date | null): string | null {
  if (d === null) return null;
  return d.getTime() === UNKNOWN_START.getTime() ? 'unknown' : iso(d);
}

export const validWindow = (from: Date, to: Date | null) =>
  `valid ${bound(from, 'open')} → ${bound(to, 'open')}`;
export const recordWindow = (from: Date, to: Date | null) =>
  `known ${bound(from, 'now')} → ${bound(to, 'now')}`;

export const plural = (n: number, word: string, many = `${word}s`) =>
  `${n} ${n === 1 ? word : many}`;

/** "1 inserted, 2 merged" for the non-zero counts, in their given order. */
export function counts(record: Record<string, number>): string {
  const parts = Object.entries(record)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${k}`);
  return parts.length > 0 ? parts.join(', ') : 'none';
}

/** The UTC day's default session id, so one day's remembers cluster together. */
export const defaultSessionId = (now: Date) => `mcp-${now.toISOString().slice(0, 10)}`;
