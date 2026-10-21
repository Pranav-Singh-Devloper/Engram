// Layout for the entity timeline (P09b task 4). Pure, so it's tested against
// the engine: "believed at K" and "true at T" are the canonical as-of rules
// (packages/core/src/temporal/asOf.ts):
//   recorded_at <= K and (invalidated_at is null or invalidated_at > K)
//   valid_from  <= T and (valid_to       is null or valid_to       > T)
import { isUnknownStart } from './format';
import type { TimelineEntry } from './api';

export interface Versioned {
  validFrom: Date;
  validTo: Date | null;
  recordedAt: Date;
  invalidatedAt: Date | null;
}

export const believedAt = (f: Pick<Versioned, 'recordedAt' | 'invalidatedAt'>, knownAt: Date) =>
  f.recordedAt <= knownAt && (f.invalidatedAt === null || f.invalidatedAt > knownAt);

export const trueAt = (f: Pick<Versioned, 'validFrom' | 'validTo'>, validAt: Date) =>
  f.validFrom <= validAt && (f.validTo === null || f.validTo > validAt);

export interface Bar {
  id: string;
  label: string;
  statement: string;
  status: string;
  /** Start on the axis; an unknown start is drawn from the axis's left edge. */
  start: Date;
  unknownStart: boolean;
  /** End on the axis; open-ended facts run to the right edge. */
  end: Date;
  open: boolean;
  recordedAt: Date;
  invalidatedAt: Date | null;
  /** Replaced by a later version (shown only with record-time history). */
  replaced: boolean;
  revises: string | null;
  supersededBy: string | null;
  /** Row within its lane, so overlapping versions don't draw over each other. */
  row: number;
}

export interface Lane {
  predicate: string;
  bars: Bar[];
  rows: number;
}

export interface TimelineLayout {
  domain: [Date, Date];
  lanes: Lane[];
}

const YEAR = 365.25 * 86_400_000;
const MIN_SPAN = 10 * 60_000;

/** Tick labels to match the axis span: hours, days, or year-months. */
export function tickUnit(domain: [Date, Date]): 'time' | 'day' | 'month' {
  const span = domain[1].getTime() - domain[0].getTime();
  return span < 2 * 86_400_000 ? 'time' : span < 120 * 86_400_000 ? 'day' : 'month';
}

/** Zoom presets only help when the history spans more than a year. */
export const zoomUseful = (domain: [Date, Date]) =>
  domain[1].getTime() - domain[0].getTime() > YEAR;

/**
 * The time axis: from the earliest known start or record time to now, padded
 * 5% on each side. If nothing has a known start, the axis spans a year
 * before the earliest record time.
 */
export function timeDomain(entries: readonly TimelineEntry[], now: Date): [Date, Date] {
  const times: number[] = [now.getTime()];
  for (const { fact } of entries) {
    if (!isUnknownStart(fact.validFrom)) times.push(fact.validFrom.getTime());
    if (fact.validTo) times.push(fact.validTo.getTime());
    times.push(fact.recordedAt.getTime());
  }
  let lo = Math.min(...times);
  const hi = Math.max(...times);
  // The axis fits the data: a live demo spans minutes, a life story decades.
  // A floor of 10 minutes keeps a single fact from collapsing to a point.
  if (hi - lo < MIN_SPAN) lo = hi - MIN_SPAN;
  const span = hi - lo;
  // An unknown start needs visible room before the earliest known date, or
  // its bar is a sliver under the fade.
  const unknown = entries.some((e) => isUnknownStart(e.fact.validFrom));
  return [new Date(lo - span * (unknown ? 0.15 : 0.05)), new Date(hi + span * 0.05)];
}

export type Zoom = 'all' | '5y' | '1y';

/** Narrows the axis to the last 5 years or year, ending at the full axis's end. */
export function zoomDomain(full: [Date, Date], zoom: Zoom): [Date, Date] {
  if (zoom === 'all') return full;
  const years = zoom === '5y' ? 5 : 1;
  const lo = Math.max(full[0].getTime(), full[1].getTime() - years * YEAR);
  return [new Date(lo), full[1]];
}

/** Lanes per predicate; versions that overlap in valid time stack into rows. */
export function layoutTimeline(
  entries: readonly TimelineEntry[],
  now: Date,
  zoom: Zoom = 'all',
): TimelineLayout {
  const domain = zoomDomain(timeDomain(entries, now), zoom);
  const byPredicate = new Map<string, TimelineEntry[]>();
  for (const e of entries)
    byPredicate.set(e.fact.predicate, [...(byPredicate.get(e.fact.predicate) ?? []), e]);
  const lanes: Lane[] = [];
  for (const [predicate, list] of [...byPredicate].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...list].sort(
      (a, b) =>
        Number(a.replaced) - Number(b.replaced) ||
        a.fact.validFrom.getTime() - b.fact.validFrom.getTime() ||
        a.fact.recordedAt.getTime() - b.fact.recordedAt.getTime(),
    );
    const rowEnds: number[] = [];
    const bars = sorted.map((e): Bar => {
      const unknownStart = isUnknownStart(e.fact.validFrom);
      const start = unknownStart || e.fact.validFrom < domain[0] ? domain[0] : e.fact.validFrom;
      const end = e.fact.validTo ?? domain[1];
      let row = rowEnds.findIndex((t) => t <= start.getTime());
      if (row === -1) row = rowEnds.length;
      rowEnds[row] = end.getTime();
      return {
        id: e.fact.id,
        label: e.objectName,
        statement: e.fact.statement,
        status: e.fact.status,
        start,
        unknownStart,
        end,
        open: e.fact.validTo === null,
        recordedAt: e.fact.recordedAt,
        invalidatedAt: e.fact.invalidatedAt,
        replaced: e.replaced,
        revises: e.fact.revises,
        supersededBy: e.fact.supersededBy,
        row,
      };
    });
    lanes.push({ predicate, bars, rows: Math.max(1, rowEnds.length) });
  }
  return { domain, lanes };
}

/** The revision chain for a fact: older versions it replaced, newest first. */
export function revisionChain(bars: readonly Bar[], id: string): Bar[] {
  const byId = new Map(bars.map((b) => [b.id, b]));
  const chain: Bar[] = [];
  let cur = byId.get(id);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    chain.push(cur);
    seen.add(cur.id);
    cur = cur.revises ? byId.get(cur.revises) : undefined;
  }
  return chain;
}
