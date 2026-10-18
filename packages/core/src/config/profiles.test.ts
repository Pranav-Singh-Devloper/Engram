import { describe, expect, it } from 'vitest';
import { config } from './index.js';
import { SIMILARITY_PROFILES, profileForSpace, similarityProfile } from './profiles.js';

describe('similarity profiles', () => {
  it("gives gemini-embedding-2 (and the fake provider) today's tuned values", () => {
    expect(profileForSpace('gemini-embedding-2')).toEqual({
      entityMatch: config.entities.matchThreshold,
      descriptionConflict: config.entities.descriptionConflictThreshold,
      merge: config.conflict.mergeThreshold,
      entitySearch: config.entities.searchMinSimilarity,
      drift: config.consolidation.driftThreshold,
      recallFloor: config.recall.floor,
    });
    expect(profileForSpace('fake')).toEqual(profileForSpace('gemini-embedding-2'));
  });

  it('looks a local space up by model, whatever its digest', async () => {
    expect(profileForSpace('embeddinggemma:300m@85462619ee72')).toBe(
      SIMILARITY_PROFILES['embeddinggemma:300m'],
    );
    expect(
      (await similarityProfile({ embeddingSpace: () => Promise.resolve('embeddinggemma:300m@x') }))
        .entitySearch,
    ).toBe(0.335);
  });

  it('refuses an uncalibrated embedder instead of borrowing another scale', () => {
    expect(() => profileForSpace('nomic-embed-text:latest@abc')).toThrow(/bench:calibrate/);
  });
});
