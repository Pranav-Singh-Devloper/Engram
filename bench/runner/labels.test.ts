import { describe, expect, it } from 'vitest';
import { agreement, parseLabels, renderLabelSheet, sampleForLabels } from './labels.js';
import type { LabelRow } from './labels.js';
import type { ItemResult } from './run.js';

const result = (
  itemId: string,
  mode: string,
  category: string,
  correct: boolean,
  judge = 'llm',
): ItemResult =>
  ({
    itemId,
    mode,
    category,
    persona: 'p1',
    question: `q ${itemId}`,
    expected: 'e',
    answer: { answer: `a | ${itemId}`, supported: true, usedMemoryIds: [], memories: 1 },
    verdict: { correct, judge, reason: 'hidden reason' },
    usage: { calls: 0, cached: 0, promptTokens: 0, outputTokens: 0 },
    latencyMs: 1,
  }) as unknown as ItemResult;

describe('label sheets', () => {
  const results = [
    ...['1', '2', '3', '4'].map((i) => result(`t-${i}`, 'engram', 'multi_hop', true)),
    ...['5', '6'].map((i) => result(`t-${i}`, 'rag', 'knowledge_update', false)),
    result('t-7', 'engram', 'single_session_recall', true, 'contains'),
  ];

  it('samples llm-judged results across groups, seeded, and hides verdicts', () => {
    const rows = sampleForLabels(results, 4, 1);
    expect(sampleForLabels(results, 4, 1)).toEqual(rows);
    expect(rows.map((r) => r.itemId)).not.toContain('t-7');
    expect(new Set(rows.map((r) => r.mode))).toEqual(new Set(['engram', 'rag']));
    const sheet = renderLabelSheet(rows, 'r1');
    expect(sheet).not.toMatch(/hidden reason|true|false/);
    expect(sheet).toContain('a \\| t-');
  });

  it('reads labels back, ignoring blanks', () => {
    const sheet = '| 1 | x | q | e | a | c |\n| 2 | x | q | e | a | I |\n| 3 | x | q | e | a |  |';
    expect([...parseLabels(sheet)]).toEqual([
      [1, true],
      [2, false],
    ]);
  });

  it("computes agreement and Cohen's κ", () => {
    const rows = [true, true, false, false].map((judgeCorrect, i): LabelRow => ({
      n: i + 1,
      itemId: `${i}`,
      mode: 'm',
      category: 'c',
      question: 'q',
      expected: 'e',
      answer: 'a',
      judgeCorrect,
    }));
    // Human agrees on 3 of 4: judge lenient on row 2.
    const a = agreement(
      rows,
      new Map([
        [1, true],
        [2, false],
        [3, false],
        [4, false],
      ]),
    );
    expect(a).toMatchObject({ n: 4, agreement: 0.75, judgeTooLenient: 1, judgeTooStrict: 0 });
    // pe = 0.5·0.25 + 0.5·0.75 = 0.5 → κ = (0.75 − 0.5) / 0.5 = 0.5
    expect(a.kappa).toBeCloseTo(0.5, 10);
    expect(agreement(rows, new Map()).n).toBe(0);
  });
});
