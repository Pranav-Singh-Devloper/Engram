import { describe, expect, it } from 'vitest';
import { TARGETS, select } from './generate.js';
import { buildPersona } from './personas.js';

describe('select', () => {
  const personas = Array.from({ length: 8 }, (_, i) => buildPersona(i, 42));

  it('meets the dev category targets and spreads items across personas', () => {
    const chosen = select(personas, TARGETS.dev, 42);
    expect(chosen).toHaveLength(40);
    for (const [category, n] of Object.entries(TARGETS.dev)) {
      expect(chosen.filter((c) => c.draft.category === category)).toHaveLength(n);
    }
    const perPersona = personas.map((p) => chosen.filter((c) => c.persona.id === p.id).length);
    expect(Math.max(...perPersona) - Math.min(...perPersona)).toBeLessThanOrEqual(2);
  });

  it('never picks the same question twice, and is deterministic', () => {
    const chosen = select(personas, TARGETS.dev, 42);
    const keys = chosen.map((c) => `${c.persona.id}:${c.draft.question}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(select(personas, TARGETS.dev, 42).map((c) => c.draft.question)).toEqual(
      chosen.map((c) => c.draft.question),
    );
  });
});
