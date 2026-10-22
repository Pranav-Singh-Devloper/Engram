// Prior art stays tied to the bibliography: every system compared is a cited
// reference, filed under its year, and every reference has a timeline role.
import { describe, expect, it } from 'vitest';
import { REFERENCES } from '@/content/references';
import { CAPABILITIES, ENGRAM, ROLE, SYSTEMS, yearOf } from './prior-art';

describe('prior art data', () => {
  const keys = REFERENCES.map((r) => r.key);

  it('compares only cited works, each under its own year, on every capability', () => {
    for (const s of [...SYSTEMS, ENGRAM]) {
      if (s !== ENGRAM) {
        expect(keys, s.name).toContain(s.ref);
        expect(s.year, s.name).toBe(yearOf(s.ref));
        for (const t of [s.adopted, s.differs, s.lacks])
          expect(t.length, s.name).toBeGreaterThan(20);
      }
      expect(Object.keys(s.cells).sort()).toEqual(CAPABILITIES.map((c) => c.key).sort());
    }
  });

  it('gives every reference a role on the timeline, and nothing else', () => {
    expect(Object.keys(ROLE).sort()).toEqual([...keys].sort());
    for (const k of keys) expect(yearOf(k), k).toBeGreaterThan(1800);
  });
});
