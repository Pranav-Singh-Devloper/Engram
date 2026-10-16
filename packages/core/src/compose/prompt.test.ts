import { describe, expect, it } from 'vitest';
import { UNKNOWN_START } from '../db/client.js';
import { DONT_KNOW, MEMORY_CHAR_CAP, composeUser, normalizeCompose } from './prompt.js';

const input = {
  question: 'Where do I live now?',
  now: new Date('2024-09-01T00:00:00Z'),
  memories: [
    {
      id: 'm1',
      kind: 'fact' as const,
      text: 'The user lives in Osaka.',
      validFrom: new Date('2024-05-01T00:00:00Z'),
      validTo: null,
    },
    {
      id: 'm2',
      kind: 'fact' as const,
      text: 'The user lived in Marseille.',
      validFrom: UNKNOWN_START,
      validTo: new Date('2015-01-01T00:00:00Z'),
    },
    {
      id: 'm3',
      kind: 'episode' as const,
      text: 'x'.repeat(MEMORY_CHAR_CAP + 50),
      validFrom: new Date('2024-06-18T09:00:00Z'),
      validTo: null,
    },
  ],
};

describe('composeUser', () => {
  it('fences memories as data, with windows, dates and a length cap', () => {
    const text = composeUser(input);
    expect(text).toContain('Today is 2024-09-01.');
    expect(text).toContain('[m1] (fact, true 2024-05-01 → now) The user lives in Osaka.');
    expect(text).toContain('[m2] (fact, true unknown → 2015-01-01)');
    expect(text).toContain('[m3] (episode, said 2024-06-18)');
    expect(text).toContain(`${'x'.repeat(MEMORY_CHAR_CAP)}…`);
    expect(text).not.toContain('x'.repeat(MEMORY_CHAR_CAP + 1));
    expect(text.indexOf('<memories>')).toBeLessThan(text.indexOf('[m1]'));
  });

  it('says when there are no memories', () => {
    expect(composeUser({ ...input, memories: [] })).toContain('<memories>\n(none)\n</memories>');
  });
});

describe('normalizeCompose', () => {
  it('turns an unsupported answer into exactly "I don\'t know." with no ids', () => {
    expect(
      normalizeCompose(
        { answer: 'Probably Osaka?', supported: false, usedMemoryIds: ['m1'] },
        input,
      ),
    ).toEqual({
      answer: DONT_KNOW,
      supported: false,
      usedMemoryIds: [],
    });
  });

  it('drops ids that were not among the memories', () => {
    const out = normalizeCompose(
      { answer: 'Osaka.', supported: true, usedMemoryIds: ['m1', 'm99'] },
      input,
    );
    expect(out.usedMemoryIds).toEqual(['m1']);
  });
});
