// Row 44: Gemini's free embedding quota counts texts (ADR-018), so the
// estimate counts the unique texts a run embeds, as the per-text cache sends them.
import { describe, expect, it } from 'vitest';
import type { BenchItem } from '../dataset/schema.js';
import { EXTRACTED_TEXTS_PER_TURN, describeEstimate, estimate } from './estimate.js';

const item = (id: string, turns: string[], question: string): BenchItem =>
  ({
    id,
    split: 'dev',
    category: 'cross_session_recall',
    persona: 'p1',
    setup_sessions: [{ session_id: 's1', occurred_at: '2024-01-01T09:00:00.000Z', turns }],
    question,
    asked_at: '2024-02-01T09:00:00.000Z',
    valid_at: null,
    known_at: null,
    expected: 'x',
    judge: 'contains',
    notes: '',
  }) as unknown as BenchItem;

// Two items sharing one history (same persona), asking different questions.
const items = [
  item('a', ['I live in Paris.', 'I work at Acme.'], 'Where?'),
  item('b', ['I live in Paris.', 'I work at Acme.'], 'Who?'),
];

describe('estimate: embedded texts', () => {
  it('counts nothing for modes that never embed', () => {
    for (const mode of ['buffer', 'full_context'] as const) {
      const e = estimate(items, [mode], false);
      expect(e.embedTexts).toBe(0);
      expect(e.extractedTexts).toBe(0);
    }
  });

  it('counts each unique turn once, plus each question as a query (rag)', () => {
    const e = estimate(items, ['rag'], false);
    expect(e.embedTexts).toBe(2 + 2);
    expect(e.extractedTexts).toBe(0);
  });

  it('shares turn texts between modes, as the per-text cache does', () => {
    expect(estimate(items, ['rag', 'engram'], false).embedTexts).toBe(4);
  });

  it('adds the facts and labels extraction will embed, per unique history (engram)', () => {
    const e = estimate(items, ['engram'], false);
    expect(e.embedTexts).toBe(4);
    expect(e.extractedTexts).toBe(Math.ceil(2 * EXTRACTED_TEXTS_PER_TURN));
  });

  it('adds up to one summary per unique session (engram_consolidated)', () => {
    expect(estimate(items, ['engram_consolidated'], false).embedTexts).toBe(4 + 1);
  });

  it('describes texts and the key-days they take', () => {
    const text = describeEstimate({ ...estimate(items, ['engram'], false), embedTexts: 2500 }, 15);
    expect(text).toMatch(/2,50\d texts? embedded/);
    expect(text).toMatch(/key-days/);
  });
});
