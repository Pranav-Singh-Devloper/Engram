// The plane's answer rule is the engine's: for every question in the story,
// the versions the explorer highlights are exactly the ones factsAsOf
// returned when the story was replayed through the engine.
import { describe, expect, it } from 'vitest';
import { believedAt, trueAt } from '@/lib/timeline';
import { STORY } from './bitemporal';

describe('bitemporal story data', () => {
  it('answers every story question exactly as the engine did', () => {
    expect(STORY.answers.length).toBeGreaterThan(5);
    for (const q of STORY.answers) {
      const validAt = q.validAt ? new Date(q.validAt) : STORY.now;
      const knownAt = q.knownAt ? new Date(q.knownAt) : STORY.now;
      const ui = STORY.versions
        .filter((v) => v.predicate === q.predicate && believedAt(v, knownAt) && trueAt(v, validAt))
        .map((v) => v.id)
        .sort();
      expect(ui, q.ask).toEqual([...q.engine].sort());
    }
  });

  it('keeps the update’s three rows linked: original revised, closed copy, new fact', () => {
    const paris = STORY.versions.filter((v) => v.object === 'Paris');
    const original = paris.find((v) => v.status === 'revised');
    const closed = paris.find((v) => v.revises === original?.id);
    const berlin = STORY.versions.find((v) => v.object === 'Berlin');
    expect(closed?.supersededBy).toBe(berlin?.id);
    expect(closed?.validTo?.getTime()).toBe(berlin?.validFrom.getTime());
    // The handoff instant: the original stops being believed when the copy starts.
    expect(original?.invalidatedAt?.getTime()).toBe(closed?.recordedAt.getTime());
  });
});
