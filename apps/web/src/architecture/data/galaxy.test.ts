// The galaxy plots one point per distinct real text, inside the unit ball the
// projection was rescaled to, and its neighbourhood statistics are sound.
import { describe, expect, it } from 'vitest';
import { GALAXY, PERSONAS, neighbourStats, neighbours } from './galaxy';

describe('galaxy data', () => {
  it('has one point per distinct text, inside the unit ball', () => {
    const texts = GALAXY.points.map((p) => p.text);
    expect(new Set(texts).size).toBe(texts.length);
    expect(GALAXY.points.length).toBeGreaterThan(300);
    for (const p of GALAXY.points) expect(Math.hypot(p.x, p.y, p.z)).toBeLessThanOrEqual(1.0001);
    expect(PERSONAS.length).toBe(8);
  });

  it('finds nearest neighbours that exclude the point itself', () => {
    const nn = neighbours(GALAXY.points.slice(0, 40), 5);
    nn.forEach((list, i) => {
      expect(list).toHaveLength(5);
      expect(list).not.toContain(i);
    });
  });

  it('shows the projection groups by meaning, not by speaker', () => {
    const stats = neighbourStats(GALAXY.points);
    const chance = 1 / PERSONAS.length;
    for (const s of stats) {
      expect(s.sameKind, s.kind).toBeGreaterThan(0.6);
      // Persona agreement stays near chance: users aren't separated by embeddings.
      expect(Math.abs(s.samePersona - chance), s.kind).toBeLessThan(0.06);
    }
  });
});
