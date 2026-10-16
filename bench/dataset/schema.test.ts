import { describe, expect, it } from 'vitest';
import { BenchItem, turnTime } from './schema.js';

const item = {
  id: 'dev-001',
  split: 'dev',
  category: 'knowledge_update',
  persona: 'p1',
  setup_sessions: [
    { session_id: 's1', occurred_at: '2024-01-15T09:00:00.000Z', turns: ['I live in Paris.'] },
  ],
  question: 'Where do I live now?',
  asked_at: '2024-09-01T00:00:00.000Z',
  valid_at: null,
  known_at: null,
  expected: 'Paris',
  judge: 'contains',
  notes: '',
};

describe('BenchItem', () => {
  it('accepts a well-formed item', () => {
    expect(BenchItem.parse(item)).toEqual(item);
  });

  it('rejects an unknown category or judge', () => {
    expect(BenchItem.safeParse({ ...item, category: 'trivia' }).success).toBe(false);
    expect(BenchItem.safeParse({ ...item, judge: 'vibes' }).success).toBe(false);
  });

  it('spaces turns a minute apart', () => {
    const session = item.setup_sessions[0];
    if (!session) throw new Error('no session');
    expect(turnTime(session, 2).toISOString()).toBe('2024-01-15T09:02:00.000Z');
  });
});
