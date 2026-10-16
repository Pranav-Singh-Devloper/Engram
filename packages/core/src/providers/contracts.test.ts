import { describe, expect, it } from 'vitest';
import {
  AdjudicateOutput,
  DisambiguateInput,
  FactCandidate,
  ProcessEpisodeOutput,
  SELF_REF,
  TemporalHint,
} from './contracts.js';

const candidate = {
  subject: { name: SELF_REF, type: 'person', description: null },
  predicate: 'lives_in',
  object: { kind: 'entity', entity: { name: 'Berlin', type: 'place', description: null } },
  statement: 'The user lives in Berlin',
  validFrom: { kind: 'named_period', year: 2024, month: 3, season: null },
  validTo: { kind: 'none' },
  isCorrection: false,
  confidence: 0.9,
};

describe('provider contracts', () => {
  it('accept a well-formed extraction', () => {
    expect(ProcessEpisodeOutput.parse({ importance: 0.7, candidates: [candidate] })).toBeTruthy();
  });

  it('reject out-of-range scores', () => {
    expect(FactCandidate.safeParse({ ...candidate, confidence: 1.2 }).success).toBe(false);
    expect(ProcessEpisodeOutput.safeParse({ importance: -0.1, candidates: [] }).success).toBe(
      false,
    );
  });

  it('accept only ISO calendar dates in absolute hints', () => {
    expect(TemporalHint.safeParse({ kind: 'absolute', date: '2024-03-01' }).success).toBe(true);
    expect(TemporalHint.safeParse({ kind: 'absolute', date: 'March 2024' }).success).toBe(false);
  });

  it('reject relative hints with fractional or negative amounts', () => {
    const hint = { kind: 'relative', unit: 'week', direction: 'ago' };
    expect(TemporalHint.safeParse({ ...hint, amount: 2 }).success).toBe(true);
    expect(TemporalHint.safeParse({ ...hint, amount: 1.5 }).success).toBe(false);
    expect(TemporalHint.safeParse({ ...hint, amount: -1 }).success).toBe(false);
  });

  it('reject entity types outside the schema list', () => {
    const bad = { ...candidate, subject: { name: 'Rex', type: 'animal', description: null } };
    expect(FactCandidate.safeParse(bad).success).toBe(false);
  });

  it('require at least two candidates to disambiguate', () => {
    const choice = { id: 'a', name: 'Sam', type: 'person', description: null, aliases: [] };
    const input = { mention: candidate.subject, context: 'Sam called', candidates: [choice] };
    expect(DisambiguateInput.safeParse(input).success).toBe(false);
  });

  it('reject an adjudication outside the four decisions', () => {
    const out = { decision: 'merge', targetFactId: null, reason: '', flagPredicate: false };
    expect(AdjudicateOutput.safeParse(out).success).toBe(false);
  });
});
