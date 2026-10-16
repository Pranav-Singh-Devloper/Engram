import { describe, expect, it } from 'vitest';
import { FakeProvider } from '@engram/core';
import type { BenchItem } from '../dataset/schema.js';
import { isAbstention, judgeAnswer, normalize } from './judge.js';

const item = (over: Partial<BenchItem>): BenchItem => ({
  id: 'dev-001',
  split: 'dev',
  category: 'cross_session_recall',
  persona: 'p1',
  setup_sessions: [{ session_id: 's', occurred_at: '2024-01-01T00:00:00.000Z', turns: ['x'] }],
  question: "What's my dog called?",
  asked_at: '2024-02-01T00:00:00.000Z',
  valid_at: null,
  known_at: null,
  expected: 'Ziggy',
  judge: 'contains',
  notes: '',
  ...over,
});
const said = (answer: string, supported = true) => ({ answer, supported });

describe('normalize', () => {
  it('folds case, accents, punctuation and articles', () => {
    expect(normalize('  The Café, in São Paulo! ')).toBe('cafe in sao paulo');
  });
});

describe('isAbstention', () => {
  it.each([
    [said("I don't know."), true],
    [said('I do not know where that is.'), true],
    [said('Something', false), true],
    [said('Your dog is Ziggy.'), false],
  ])('%j → %s', (answer, expected) => {
    expect(isAbstention(answer)).toBe(expected);
  });
});

describe('judgeAnswer', () => {
  it('contains: the expected value anywhere in the answer', async () => {
    expect((await judgeAnswer(item({}), said('Your dog is called Ziggy.'))).correct).toBe(true);
    expect((await judgeAnswer(item({}), said('Your dog is called Biscuit.'))).correct).toBe(false);
  });

  it('exact: the whole normalized answer', async () => {
    const exact = item({ judge: 'exact' });
    expect((await judgeAnswer(exact, said('ziggy.'))).correct).toBe(true);
    expect((await judgeAnswer(exact, said('It is Ziggy.'))).correct).toBe(false);
  });

  it('abstention items are correct exactly when the system abstained', async () => {
    const absent = item({ category: 'abstention', expected: "I don't know", judge: 'exact' });
    expect(await judgeAnswer(absent, said("I don't know.", false))).toMatchObject({
      correct: true,
      judge: 'abstention',
    });
    expect((await judgeAnswer(absent, said('Your brother is Tom.'))).correct).toBe(false);
  });

  it('abstaining on an answerable question is wrong', async () => {
    expect(await judgeAnswer(item({}), said("I don't know.", false))).toMatchObject({
      correct: false,
    });
  });

  it('llm: asks the judge, or falls back to containment without one', async () => {
    const llmItem = item({ judge: 'llm', expected: 'May 2024' });
    const fake = new FakeProvider().when('judge', () => true, {
      correct: true,
      reason: 'same month',
    });
    expect(await judgeAnswer(llmItem, said('In early May of 2024.'), fake)).toMatchObject({
      correct: true,
      judge: 'llm',
    });
    expect(await judgeAnswer(llmItem, said('In May 2024.'))).toMatchObject({
      correct: true,
      judge: 'contains',
    });
  });
});
