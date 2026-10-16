// Resolves the model's temporal hints into dates. All arithmetic happens here,
// against the episode's `occurred_at` and never the wall clock (SPEC §6.1), in
// UTC at day precision.
import type { TemporalHint } from '../providers/contracts.js';

/** `start` for valid_from, `end` (exclusive) for valid_to. */
export type Edge = 'start' | 'end';

type Season = 'spring' | 'summer' | 'autumn' | 'winter';

/** Meteorological seasons: first month, 1-based. Winter runs December to February. */
const SEASON_START: Record<Season, number> = { spring: 3, summer: 6, autumn: 9, winter: 12 };

function utc(year: number, month: number, day = 1): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function startOfDay(date: Date): Date {
  return utc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** Adds months, clamping the day so 31 March minus a month is 29 February. */
function addMonths(date: Date, months: number): Date {
  const total = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return utc(year, month, Math.min(date.getUTCDate(), lastDay));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** [start, end) of a month or season with a known year. */
function period(year: number, firstMonth: number, months: number): [Date, Date] {
  const start = utc(year, firstMonth);
  return [start, addMonths(start, months)];
}

/** The latest year in which `firstMonth` of that year starts at or before `ref`. */
function latestYear(firstMonth: number, ref: Date): number {
  const year = ref.getUTCFullYear();
  return utc(year, firstMonth) <= ref ? year : year - 1;
}

export function resolveHint(hint: TemporalHint, occurredAt: Date, edge: Edge): Date | null {
  switch (hint.kind) {
    case 'none':
      return null;

    case 'absolute': {
      const [y, m, day] = hint.date.split('-').map(Number) as [number, number, number];
      return utc(y, m, day);
    }

    case 'relative': {
      const sign = hint.direction === 'ago' ? -1 : 1;
      const base = startOfDay(occurredAt);
      switch (hint.unit) {
        case 'day':
          return addDays(base, sign * hint.amount);
        case 'week':
          return addDays(base, sign * hint.amount * 7);
        case 'month':
          return addMonths(base, sign * hint.amount);
        case 'year':
          return addMonths(base, sign * hint.amount * 12);
      }
      break;
    }

    case 'named_period': {
      let range: [Date, Date];
      if (hint.month !== null) {
        const year = hint.year ?? latestYear(hint.month, occurredAt);
        range = period(year, hint.month, 1);
      } else if (hint.season !== null) {
        const first = SEASON_START[hint.season];
        const year = hint.year ?? latestYear(first, occurredAt);
        range = period(year, first, 3);
      } else if (hint.year !== null) {
        range = period(hint.year, 1, 12);
      } else {
        return null;
      }
      return edge === 'start' ? range[0] : range[1];
    }
  }
}
