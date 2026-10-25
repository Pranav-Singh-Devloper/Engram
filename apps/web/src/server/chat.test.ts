import { describe, expect, it } from 'vitest';
import { looksLikeQuestion } from './chat';

describe('looksLikeQuestion', () => {
  it.each([
    'Where do I live?',
    'where do i live',
    'Do I have a cat',
    'Tell me where I work',
    'and before that?',
  ])('reads %j as a question', (m) => {
    expect(looksLikeQuestion(m)).toBe(true);
  });

  it.each([
    'I just moved to Berlin.',
    'Actually, I work at Acme, not Initech.',
    'Hello there',
    'Whoever said that was wrong.',
  ])('reads %j as a statement', (m) => {
    expect(looksLikeQuestion(m)).toBe(false);
  });
});
