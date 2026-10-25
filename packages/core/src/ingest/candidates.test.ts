// resolveWindow: candidates' hints become validity windows (SPEC §6.1).
import { describe, expect, it } from 'vitest';
import type { FactCandidate, TemporalHint } from '../providers/contracts.js';
import { resolveWindow } from './candidates.js';

const none: TemporalHint = { kind: 'none' };
const candidate = (validFrom: TemporalHint, validTo: TemporalHint = none) =>
  ({ validFrom, validTo }) as unknown as FactCandidate;
// A turn said in the afternoon (UTC).
const said = new Date('2026-10-25T13:02:42Z');

describe('resolveWindow', () => {
  it('starts an undated fact at the moment it was said', () => {
    expect(resolveWindow(candidate(none), said)).toMatchObject({
      validFrom: said,
      validFromSource: 'episode',
      validTo: null,
    });
  });

  it('starts "today" at the moment it was said, not at midnight', () => {
    // Found on the hosted demo, 2026-10-25: "I just moved to Berlin." resolved to
    // 00:00 the same day, before an undated "I live in Paris." said at 13:01, so
    // the move was filed as older history. Day precision can't order events
    // within its own day; the turn's own moment can.
    const today: TemporalHint = { kind: 'relative', amount: 0, unit: 'day', direction: 'ago' };
    expect(resolveWindow(candidate(today), said)).toMatchObject({
      validFrom: said,
      validFromSource: 'explicit',
    });
    const dated: TemporalHint = { kind: 'absolute', date: '2026-10-25' };
    expect(resolveWindow(candidate(dated), said).validFrom).toEqual(said);
  });

  it('keeps day precision for any other day', () => {
    const yesterday: TemporalHint = { kind: 'relative', amount: 1, unit: 'day', direction: 'ago' };
    expect(resolveWindow(candidate(yesterday), said).validFrom).toEqual(
      new Date('2026-10-24T00:00:00Z'),
    );
    const march: TemporalHint = { kind: 'named_period', year: 2026, month: 3, season: null };
    expect(resolveWindow(candidate(march), said).validFrom).toEqual(
      new Date('2026-03-01T00:00:00Z'),
    );
  });

  it('keeps a start later the same day as given (a plan for this evening stays in the future)', () => {
    const tomorrow: TemporalHint = {
      kind: 'relative',
      amount: 1,
      unit: 'day',
      direction: 'from_now',
    };
    expect(resolveWindow(candidate(tomorrow), said).validFrom).toEqual(
      new Date('2026-10-26T00:00:00Z'),
    );
  });

  it('gives a past bound with no start an unknown start', () => {
    const y2015: TemporalHint = { kind: 'named_period', year: 2015, month: null, season: null };
    expect(resolveWindow(candidate(none, y2015), said)).toMatchObject({
      validFromSource: 'unknown',
      validTo: new Date('2015-01-01T00:00:00Z'),
    });
  });
});
