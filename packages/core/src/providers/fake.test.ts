import { describe, expect, it } from 'vitest';
import { EMBEDDING_DIM } from '../config/index.js';
import { cosine } from '../db/vector.js';
import { FakeProvider, FakeProviderError, fakeEmbedding } from './fake.js';

describe('fake embeddings', () => {
  it('are deterministic, unit-norm and the right size', async () => {
    const fake = new FakeProvider();
    const [a, b] = await fake.embed(['Sam lives in Berlin', 'Sam lives in Berlin'], {
      purpose: 'document',
    });
    expect(a).toEqual(b);
    expect(a).toHaveLength(EMBEDDING_DIM);
    expect(Math.hypot(...(a ?? []))).toBeCloseTo(1, 10);
  });

  it('put texts that share words closer than unrelated ones', () => {
    const base = fakeEmbedding('Sam moved to Berlin in March');
    const paraphrase = fakeEmbedding('In March, Sam moved to Berlin for work');
    const unrelated = fakeEmbedding('The user prefers green tea');
    expect(cosine(base, paraphrase)).toBeGreaterThan(0.7);
    expect(cosine(base, paraphrase)).toBeGreaterThan(cosine(base, unrelated) + 0.5);
  });

  it('ignore case and punctuation', () => {
    expect(fakeEmbedding('Berlin!')).toEqual(fakeEmbedding('berlin'));
  });

  it('give empty text a fixed unit vector', () => {
    expect(fakeEmbedding('')).toEqual(fakeEmbedding('  ?! '));
    expect(Math.hypot(...fakeEmbedding(''))).toBeCloseTo(1, 10);
  });
});

describe('fake structured methods', () => {
  const judgeInput = { question: 'Where does Sam live?', expected: 'Berlin', answer: 'Berlin' };

  it('throw when nothing is scripted', async () => {
    await expect(new FakeProvider().judge(judgeInput)).rejects.toThrow(FakeProviderError);
  });

  it('match on a substring of the input JSON', async () => {
    const fake = new FakeProvider().when('judge', 'Berlin', { correct: true, reason: 'same city' });
    await expect(fake.judge(judgeInput)).resolves.toEqual({ correct: true, reason: 'same city' });
    await expect(fake.judge({ ...judgeInput, expected: 'Paris', answer: 'Rome' })).rejects.toThrow(
      /No scripted judge response/,
    );
  });

  it('match on a predicate over the parsed input and compute the reply', async () => {
    const fake = new FakeProvider().when(
      'judge',
      (input) => input.answer.length > 0,
      (input) => ({ correct: input.answer === input.expected, reason: 'compared' }),
    );
    await expect(fake.judge({ ...judgeInput, answer: 'Paris' })).resolves.toMatchObject({
      correct: false,
    });
  });

  it('use the first matching script', async () => {
    const fake = new FakeProvider()
      .when('judge', 'Berlin', { correct: true, reason: 'first' })
      .when('judge', 'Berlin', { correct: false, reason: 'second' });
    await expect(fake.judge(judgeInput)).resolves.toMatchObject({ reason: 'first' });
  });

  it('validate scripted replies against the contract', async () => {
    const fake = new FakeProvider().when('processEpisode', 'hello', {
      importance: 3,
      candidates: [],
    });
    const input = {
      content: 'hello',
      role: 'user' as const,
      occurredAt: new Date(),
      predicates: [],
    };
    await expect(fake.processEpisode(input)).rejects.toThrow(/importance/);
  });

  it('validate inputs too, so a test bug fails loudly', async () => {
    const fake = new FakeProvider().when('judge', () => true, { correct: true, reason: '' });
    // @ts-expect-error missing `answer`
    await expect(fake.judge({ question: 'q', expected: 'e' })).rejects.toThrow(/answer/);
  });

  it('record every call', async () => {
    const fake = new FakeProvider().when('judge', () => true, { correct: true, reason: '' });
    await fake.embed(['a'], { purpose: 'query' });
    await fake.judge(judgeInput);
    expect(fake.calls.map((c) => c.method)).toEqual(['embed', 'judge']);
    expect(fake.callsTo('embed')).toEqual([{ texts: ['a'], purpose: 'query' }]);
  });

  it("don't let callers mutate a script through its result", async () => {
    const reply = { correct: true, reason: 'original' };
    const fake = new FakeProvider().when('judge', () => true, reply);
    const first = await fake.judge(judgeInput);
    first.reason = 'mutated';
    await expect(fake.judge(judgeInput)).resolves.toMatchObject({ reason: 'original' });
  });
});
