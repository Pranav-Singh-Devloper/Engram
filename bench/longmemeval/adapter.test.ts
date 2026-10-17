import { describe, expect, it } from 'vitest';
import { BenchItem } from '../dataset/schema.js';
import { LME_TYPES, parseLmeDate, selectSubset, toBenchItem } from './adapter.js';
import type { RawItem } from './adapter.js';

const raw = (id: string, type: string): RawItem => ({
  question_id: id,
  question_type: type,
  question: 'What did you recommend for my trip?',
  answer: 42,
  question_date: '2023/05/30 (Tue) 10:00',
  haystack_session_ids: ['b', 'a'],
  haystack_dates: ['2023/05/21 (Sun) 09:00', '2023/05/20 (Sat) 02:21'],
  haystack_sessions: [
    [
      { role: 'user', content: 'Any tips for Kyoto?' },
      { role: 'assistant', content: 'Try the Fushimi Inari shrine early.', has_answer: true },
    ],
    [
      { role: 'user', content: '   ' },
      { role: 'user', content: 'Hi!' },
    ],
  ],
});

describe('LongMemEval adapter', () => {
  it('parses its dates as UTC', () => {
    expect(parseLmeDate('2023/05/20 (Sat) 02:21')).toBe('2023-05-20T02:21:00.000Z');
    expect(() => parseLmeDate('May 20')).toThrow(/Unrecognized/);
  });

  it('maps an item: sessions in time order with roles, empty turns dropped, a valid BenchItem', () => {
    const item = toBenchItem(raw('q1', 'single-session-assistant'));
    expect(BenchItem.parse(item)).toEqual(item);
    expect(item).toMatchObject({
      id: 'lme-q1',
      split: 'longmemeval',
      category: 'single_session_recall',
      asked_at: '2023-05-30T10:00:00.000Z',
      expected: '42',
      judge: 'llm',
      notes: 'lme:single-session-assistant',
    });
    expect(item.setup_sessions.map((s) => [s.session_id, s.turns, s.roles])).toEqual([
      ['a', ['Hi!'], ['user']],
      ['b', ['Any tips for Kyoto?', 'Try the Fushimi Inari shrine early.'], ['user', 'assistant']],
    ]);
  });

  it('marks _abs items as abstention', () => {
    expect(toBenchItem(raw('q2_abs', 'multi-session')).category).toBe('abstention');
    expect(toBenchItem(raw('q3', 'multi-session')).category).toBe('cross_session_recall');
  });

  it('selects a seeded, stratified subset that keeps every type and abstention', () => {
    const pool = LME_TYPES.flatMap((t, ti) =>
      Array.from({ length: 10 + ti * 5 }, (_, i) => raw(`${ti}-${i}${i === 0 ? '_abs' : ''}`, t)),
    );
    const a = selectSubset(pool, 30, 7);
    expect(selectSubset(pool, 30, 7)).toEqual(a);
    expect(new Set(a.map((r) => r.question_type))).toEqual(new Set(LME_TYPES));
    expect(a.some((r) => r.question_id.endsWith('_abs'))).toBe(true);
    expect(a.length).toBeGreaterThanOrEqual(28);
    expect(a.length).toBeLessThanOrEqual(36);
  });
});
