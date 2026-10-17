import { describe, expect, it } from 'vitest';
import { FILLER_SESSIONS, checkFiller, checkShape, fillerPlans, personaStrings } from './filler.js';
import { buildPersona } from './personas.js';

describe('fillerPlans', () => {
  const p = buildPersona(0, 42);
  const askedAt = new Date((p.sessions.at(-1)?.occurredAt.getTime() ?? 0) + 7 * 86_400_000);
  const plans = fillerPlans(p, 42, askedAt);

  it('is deterministic and places every session before the questions', () => {
    expect(fillerPlans(p, 42, askedAt)).toEqual(plans);
    expect(plans).toHaveLength(FILLER_SESSIONS);
    for (const f of plans) expect(f.occurredAt.getTime()).toBeLessThan(askedAt.getTime());
  });

  it('puts two sessions before the first fact session and never on a fact session', () => {
    const first = p.sessions[0]?.occurredAt.getTime() ?? 0;
    expect(plans.filter((f) => f.occurredAt.getTime() < first)).toHaveLength(2);
    const factDays = new Set(p.sessions.map((s) => s.occurredAt.toISOString().slice(0, 10)));
    for (const f of plans)
      expect(factDays.has(f.occurredAt.toISOString().slice(0, 10))).toBe(false);
  });

  it('uses distinct topics', () => {
    expect(new Set(plans.map((f) => f.topic)).size).toBe(plans.length);
  });
});

describe('checkFiller', () => {
  const forbid = personaStrings(buildPersona(0, 42));

  it('accepts impersonal requests', () => {
    expect(checkFiller(['How do I fix a squeaky hinge?', 'Thanks, that worked!'], forbid)).toEqual(
      [],
    );
  });

  it('accepts short greetings with punctuation and apostrophes', () => {
    expect(checkShape(["Hi, I'm Kwame.", 'I moved to Accra last year.'])).toEqual([]);
  });

  it('rejects packed transcripts and junk turns', () => {
    expect(checkFiller(['> How do I fix it? > Thanks! >', 'ok then'], [])).toContain(
      'packs several messages into one turn',
    );
    expect(checkFiller(['How do I fix a hinge?', 'turn_count_check'], [])).toContain(
      '"turn_count_check" is not a message',
    );
    expect(checkFiller(['How do I fix a hinge?', '>])}'], []).length).toBeGreaterThan(0);
  });

  it('rejects persona strings and personal facts', () => {
    const name = buildPersona(0, 42).name;
    expect(checkFiller([`Hi, ${name} here.`], forbid)).toContain(`mentions "${name}"`);
    expect(checkFiller(['My sister says hi'], forbid)).toContain('personal fact ("my sister")');
  });
});
