import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TemporalHint } from '../providers/contracts.js';
import { resolveHint } from './temporal.js';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
// Mid-morning on 10 June 2024, so truncation to the day is visible.
const occurred = new Date('2024-06-10T09:30:00Z');

afterEach(() => {
  vi.useRealTimers();
});

describe('resolveHint', () => {
  it('returns null for none', () => {
    expect(resolveHint({ kind: 'none' }, occurred, 'start')).toBeNull();
  });

  it('takes absolute dates as given, at UTC midnight', () => {
    const hint: TemporalHint = { kind: 'absolute', date: '2019-04-02' };
    expect(resolveHint(hint, occurred, 'start')).toEqual(d('2019-04-02'));
    expect(resolveHint(hint, occurred, 'end')).toEqual(d('2019-04-02'));
  });

  it.each<[string, TemporalHint, string]>([
    ['yesterday', { kind: 'relative', amount: 1, unit: 'day', direction: 'ago' }, '2024-06-09'],
    ['last week', { kind: 'relative', amount: 1, unit: 'week', direction: 'ago' }, '2024-06-03'],
    ['last month', { kind: 'relative', amount: 1, unit: 'month', direction: 'ago' }, '2024-05-10'],
    [
      'two years ago',
      { kind: 'relative', amount: 2, unit: 'year', direction: 'ago' },
      '2022-06-10',
    ],
    [
      'in three days',
      { kind: 'relative', amount: 3, unit: 'day', direction: 'from_now' },
      '2024-06-13',
    ],
  ])('resolves "%s" against occurred_at', (_label, hint, expected) => {
    expect(resolveHint(hint, occurred, 'start')).toEqual(d(expected));
  });

  it('clamps month arithmetic to the end of shorter months', () => {
    const hint: TemporalHint = { kind: 'relative', amount: 1, unit: 'month', direction: 'ago' };
    expect(resolveHint(hint, new Date('2024-03-31T12:00:00Z'), 'start')).toEqual(d('2024-02-29'));
    const yearAgo: TemporalHint = { kind: 'relative', amount: 1, unit: 'year', direction: 'ago' };
    expect(resolveHint(yearAgo, new Date('2024-02-29T12:00:00Z'), 'start')).toEqual(
      d('2023-02-28'),
    );
  });

  describe('named periods', () => {
    const period = (p: { year?: number; month?: number; season?: string }): TemporalHint =>
      ({
        kind: 'named_period',
        year: p.year ?? null,
        month: p.month ?? null,
        season: p.season ?? null,
      }) as TemporalHint;

    it('cover a whole year: start for valid_from, the next year for valid_to', () => {
      expect(resolveHint(period({ year: 2015 }), occurred, 'start')).toEqual(d('2015-01-01'));
      expect(resolveHint(period({ year: 2018 }), occurred, 'end')).toEqual(d('2019-01-01'));
    });

    it('cover a month of a given year', () => {
      expect(resolveHint(period({ year: 2023, month: 12 }), occurred, 'start')).toEqual(
        d('2023-12-01'),
      );
      expect(resolveHint(period({ year: 2023, month: 12 }), occurred, 'end')).toEqual(
        d('2024-01-01'),
      );
    });

    it('read a month without a year as its latest occurrence at or before occurred_at', () => {
      // "since March", said in June 2024
      expect(resolveHint(period({ month: 3 }), occurred, 'start')).toEqual(d('2024-03-01'));
      // "since June", said in June: this June
      expect(resolveHint(period({ month: 6 }), occurred, 'start')).toEqual(d('2024-06-01'));
      // "since September", said in June: last September
      expect(resolveHint(period({ month: 9 }), occurred, 'start')).toEqual(d('2023-09-01'));
    });

    it('map seasons to meteorological months, winter spanning the new year', () => {
      expect(resolveHint(period({ year: 2023, season: 'summer' }), occurred, 'start')).toEqual(
        d('2023-06-01'),
      );
      expect(resolveHint(period({ year: 2023, season: 'winter' }), occurred, 'start')).toEqual(
        d('2023-12-01'),
      );
      expect(resolveHint(period({ year: 2023, season: 'winter' }), occurred, 'end')).toEqual(
        d('2024-03-01'),
      );
    });

    it('read a season without a year as its latest start at or before occurred_at', () => {
      // "this summer", said on 10 June 2024
      expect(resolveHint(period({ season: 'summer' }), occurred, 'start')).toEqual(d('2024-06-01'));
      // "last winter", said in June 2024: December 2023
      expect(resolveHint(period({ season: 'winter' }), occurred, 'start')).toEqual(d('2023-12-01'));
    });

    it('prefer the month when both a month and a season are given', () => {
      expect(
        resolveHint(period({ year: 2022, month: 7, season: 'winter' }), occurred, 'start'),
      ).toEqual(d('2022-07-01'));
    });

    it('treat an empty period as no hint', () => {
      expect(resolveHint(period({}), occurred, 'start')).toBeNull();
    });

    it('cross a year boundary when needed', () => {
      // "since December", said on 5 January 2025
      const jan = new Date('2025-01-05T08:00:00Z');
      expect(resolveHint(period({ month: 12 }), jan, 'start')).toEqual(d('2024-12-01'));
    });
  });

  it('never depends on the system clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2031-01-01T00:00:00Z'));
    const hint: TemporalHint = { kind: 'relative', amount: 1, unit: 'week', direction: 'ago' };
    expect(resolveHint(hint, occurred, 'start')).toEqual(d('2024-06-03'));
    expect(
      resolveHint({ kind: 'named_period', year: null, month: 3, season: null }, occurred, 'start'),
    ).toEqual(d('2024-03-01'));
  });
});
