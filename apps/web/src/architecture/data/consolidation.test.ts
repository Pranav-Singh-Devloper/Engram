// The consolidation chapter's skip rule is the engine's: at the engine's
// minImportance it splits the real history exactly as consolidate() did.
import { config } from '@engram/core';
import { describe, expect, it } from 'vitest';
import { CONSOLIDATION, CONSOLIDATION_CONFIG, WEAK_INFERENCES, skips } from './consolidation';

describe('consolidation chapter data', () => {
  it('mirrors core’s consolidation settings', () => {
    expect(CONSOLIDATION_CONFIG).toEqual(config.consolidation);
  });

  it('skips and summarizes exactly the sessions the engine did', () => {
    const { sessions, consolidation } = CONSOLIDATION;
    const min = CONSOLIDATION_CONFIG.minImportance;
    for (const s of sessions) expect(skips(s, min), s.id).toBe(s.summary === null);
    expect(sessions.filter((s) => !skips(s, min))).toHaveLength(consolidation.summarized);
    expect(sessions.filter((s) => skips(s, min))).toHaveLength(consolidation.skipped);
  });

  it('flags only weak inferences that consolidation actually inserted', () => {
    for (const w of WEAK_INFERENCES) expect(CONSOLIDATION.testSplit.inserted).toContain(w);
  });
});
