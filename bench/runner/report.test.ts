import { describe, expect, it } from 'vitest';
import { BenchSummary } from '@engram/core';
import { renderReport, summarizeRun } from './report.js';
import type { ItemResult } from './run.js';

const meta = { runId: 'r', split: 'dev-long', model: 'm', judge: 'j', date: '2026-10-17' };

function result(
  over: Omit<Partial<ItemResult>, 'answer'> & { answer: Partial<ItemResult['answer']> },
): ItemResult {
  return {
    itemId: 'dev-001',
    mode: 'engram',
    category: 'cross_session_recall',
    persona: 'p1',
    question: 'q',
    expected: 'Ziggy',
    verdict: { correct: true, judge: 'contains', reason: '' },
    usage: { calls: 0, cached: 0, promptTokens: 0, outputTokens: 0 },
    latencyMs: 1,
    ...over,
    answer: { ...{ answer: 'a', supported: true, usedMemoryIds: [], memories: 1 }, ...over.answer },
  };
}

describe('renderReport', () => {
  it('compares rankers on recall@8 from a retrieval-only run', () => {
    const report = renderReport(
      [
        result({ answer: { retrievedBy: { rrf: ['Ziggy is a dog'], linear: ['unrelated'] } } }),
        result({
          itemId: 'dev-002',
          answer: { retrievedBy: { rrf: ['nope'], linear: ['Ziggy!'] } },
        }),
      ],
      meta,
    );
    expect(report).toContain('| rrf | 50% (1/2) |');
    expect(report).toContain('| linear | 50% (1/2) |');
  });

  it('simulates abstention floors from one floor-0 run', () => {
    const report = renderReport(
      [
        result({ answer: { bestSimilarity: 0.8, floor: 0 } }),
        result({
          itemId: 'dev-002',
          category: 'abstention',
          expected: "I don't know",
          verdict: { correct: false, judge: 'abstention', reason: '' },
          answer: { bestSimilarity: 0.4, floor: 0 },
        }),
      ],
      meta,
    );
    // At floor 0.5 the abstention item drops below and becomes correct; the other stays correct.
    expect(report).toMatch(/\| 0\.5 \| 100% \| 100% \| 0 \|/);
    // At floor 0 nothing changes.
    expect(report).toMatch(/\| 0 \| 50% \| 0% \| 0 \|/);
  });
});

describe('summarizeRun', () => {
  const finishedAt = '2026-10-17T12:00:00.000Z';

  it('gives accuracy and recall@8 per mode, in the shape engram://stats reads', () => {
    const summary = summarizeRun(
      [
        result({ answer: { retrieved: ['Ziggy is a dog'] } }),
        result({
          itemId: 'dev-002',
          verdict: { correct: false, judge: 'contains', reason: '' },
          answer: { retrieved: ['nothing useful'] },
        }),
        result({ mode: 'buffer', answer: {} }),
      ],
      { ...meta, finishedAt },
    );
    expect(BenchSummary.parse(summary)).toEqual({
      schema: 1,
      runId: 'r',
      split: 'dev-long',
      date: '2026-10-17',
      finishedAt,
      model: 'm',
      judge: 'j',
      items: 2,
      retrievalOnly: false,
      modes: {
        buffer: { accuracy: 1, n: 1, recallAt8: null },
        engram: { accuracy: 0.5, n: 2, recallAt8: 0.5 },
      },
    });
  });

  it('marks ranker comparisons as retrieval-only', () => {
    const summary = summarizeRun(
      [result({ answer: { retrievedBy: { rrf: ['Ziggy'], linear: ['Ziggy'] } } })],
      { ...meta, finishedAt },
    );
    expect(summary.retrievalOnly).toBe(true);
  });
});
