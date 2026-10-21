// The recall chapter's rankers are the engine's: at the engine's settings they
// reproduce the scores recall() recorded, and at any k they match core's rrf.
import { config, rrf as coreRrf, withPriors } from '@engram/core';
import { describe, expect, it } from 'vitest';
import {
  LINEAR_WEIGHTS,
  LIST_NAMES,
  RECALL,
  rankLinear,
  rankRrf,
  rrf,
  simulateFloor,
} from './recall';

describe('recall chapter data', () => {
  it('mirrors core’s ranker settings', () => {
    expect(LINEAR_WEIGHTS).toEqual(config.recall.linearWeights);
    for (const t of RECALL.traces) {
      expect(t.rrfK).toBe(config.recall.rrfK);
      expect(t.weights).toEqual({
        recency: config.recall.recencyWeight,
        importance: config.recall.importanceWeight,
        self: config.recall.selfWeight,
      });
    }
  });

  it('reproduces the engine’s RRF scores and returned order for every traced query', () => {
    expect(RECALL.traces.length).toBeGreaterThanOrEqual(4);
    for (const t of RECALL.traces) {
      const ranked = rankRrf(t, t.rrfK);
      for (const r of ranked) expect(r.score, `${t.query}: ${r.c.text}`).toBeCloseTo(r.c.score, 12);
      expect(
        ranked.slice(0, RECALL.k).map((r) => r.c.key),
        t.query,
      ).toEqual(t.returned);
    }
  });

  it('matches core rrf and withPriors at every k the slider offers', () => {
    for (const t of RECALL.traces) {
      const lists = LIST_NAMES.map((n) => t.lists[n]);
      for (const k of [1, 5, 20, 60, 120, 250]) {
        const mine = rrf(lists, k);
        const core = coreRrf(lists, k);
        expect([...mine.entries()]).toEqual([...core.entries()]);
        const byKey = new Map(rankRrf(t, k).map((r) => [r.c.key, r.score]));
        for (const c of t.candidates) {
          const expected = withPriors(core.get(c.key) ?? 0, c, {
            recency: t.weights.recency,
            importance: t.weights.importance,
            self: t.weights.self,
          });
          expect(byKey.get(c.key)).toBeCloseTo(expected, 12);
        }
      }
    }
  });

  it('reproduces the engine’s linear-ranker scores', () => {
    for (const t of RECALL.traces) {
      for (const r of rankLinear(t)) {
        expect(r.score, `${t.query}: ${r.c.text}`).toBeCloseTo(t.linearScores[r.c.key] ?? NaN, 12);
      }
    }
  });

  it('simulates floors exactly as the bench report does', () => {
    expect(RECALL.floors.length).toBe(2);
    for (const run of RECALL.floors) {
      expect(run.items.length).toBe(40);
      for (const g of run.grid) {
        const { floor, ...expected } = g;
        expect(simulateFloor(run.items, floor), `${run.space} @ ${String(floor)}`).toEqual(
          expected,
        );
      }
    }
  });
});
