import { describe, expect, it } from 'vitest';
import type { GroqRequest } from '@engram/core';
import type { SessionPlan } from './personas.js';
import { checkTurns, verbalizeSession } from './verbalize.js';

const plan: SessionPlan = {
  sessionId: 'p1-s3',
  occurredAt: new Date('2024-06-18T09:00:00Z'),
  statements: [
    {
      key: 'move',
      says: 'Implicitly: you live in Osaka since May.',
      mustInclude: ['Osaka', 'May'],
      style: 'implicit',
    },
    { key: 'pet-again', says: 'Mention Ziggy again.', mustInclude: ['Ziggy'], style: 'paraphrase' },
  ],
};

describe('checkTurns', () => {
  it('accepts turns that carry every required string', () => {
    expect(
      checkTurns(['Loving my Osaka neighbourhood since May!', 'Ziggy approves.'], plan, [
        'brother',
      ]),
    ).toEqual([]);
  });

  it('flags missing strings, forbidden topics and an explicit "moved"', () => {
    const problems = checkTurns(['I moved to Osaka in May with my brother.'], plan, ['brother']);
    expect(problems).toEqual([
      'says "moved"; keep the move implicit',
      'missing "Ziggy"',
      'mentions "brother", which must not come up',
    ]);
  });

  it('matches forbidden words whole, so "car" does not hit "careful"', () => {
    expect(checkTurns(['Careful in Osaka since May, Ziggy!'], plan, ['car'])).toEqual([]);
  });
});

describe('verbalizeSession', () => {
  it('retries with feedback until the turns pass, then returns them', async () => {
    const replies = [
      ['Living in Osaka since May.'],
      ['Osaka since May is great.', 'Ziggy loves it.'],
    ];
    const prompts: string[] = [];
    const llm = {
      generate: <T>(req: GroqRequest<T>) => {
        prompts.push(req.user);
        return Promise.resolve({ turns: replies.shift() } as T);
      },
    };
    await expect(verbalizeSession(llm, 'Priya', plan, [])).resolves.toEqual([
      'Osaka since May is great.',
      'Ziggy loves it.',
    ]);
    expect(prompts[1]).toContain('missing "Ziggy"');
  });

  it('gives up after the allowed attempts', async () => {
    const llm = { generate: <T>() => Promise.resolve({ turns: ['nothing useful'] } as T) };
    await expect(verbalizeSession(llm, 'Priya', plan, [], 2)).rejects.toThrow(/after 2 attempts/);
  });
});
