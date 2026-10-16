import { describe, expect, it } from 'vitest';
import { believedHomeAt, buildPersona, homeAt } from './personas.js';
import { ABSTAIN, questionsFor } from './questions.js';

// Off-registry statement kinds, listed by hand: this test must not consult
// Engram's predicate registry either (SPEC §13.2).
const OFF_REGISTRY = new Set([
  'pet',
  'pet-again',
  'sister',
  'allergy',
  'instrument',
  'partner',
  'language',
]);

const d = (iso: string) => new Date(iso);

describe('buildPersona', () => {
  it('is deterministic for a seed and varies across seeds', () => {
    expect(buildPersona(0, 42)).toEqual(buildPersona(0, 42));
    expect(buildPersona(0, 42)).not.toEqual(buildPersona(0, 43));
    expect(buildPersona(0, 42)).not.toEqual(buildPersona(1, 42));
  });

  it('puts at least 30% of statements outside the registry relations', () => {
    for (let i = 0; i < 8; i++) {
      const statements = buildPersona(i, 42).sessions.flatMap((s) => s.statements);
      const off = statements.filter((s) => OFF_REGISTRY.has(s.key)).length;
      expect(off / statements.length).toBeGreaterThanOrEqual(0.3);
    }
  });

  it('orders sessions in time, with the move between sessions 2 and 3', () => {
    for (let i = 0; i < 8; i++) {
      const p = buildPersona(i, 42);
      const times = p.sessions.map((s) => s.occurredAt.getTime());
      expect([...times].sort((a, b) => a - b)).toEqual(times);
      const move = p.homes[2]?.from?.getTime() ?? 0;
      expect(move).toBeGreaterThan(times[1] ?? 0);
      expect(move).toBeLessThan(times[2] ?? 0);
    }
  });

  it('has a contiguous home history', () => {
    const p = buildPersona(3, 42);
    const [old, first, second] = p.homes;
    expect(old?.to).toEqual(first?.from);
    expect(first?.to).toEqual(second?.from);
    expect(second?.to).toBeNull();
  });
});

describe('ground truth', () => {
  const p = buildPersona(2, 42);
  const [old, first, second] = p.homes;
  if (!old?.from || !first?.from || !second?.from) throw new Error('bad persona');
  const oldFrom = old.from;
  const moveFrom = second.from;

  it('answers valid-time questions from the timeline', () => {
    expect(homeAt(p, new Date(oldFrom.getTime() + 86_400_000))).toBe(old.city);
    expect(homeAt(p, new Date(moveFrom.getTime() - 1))).toBe(first.city);
    expect(homeAt(p, moveFrom)).toBe(second.city);
  });

  it('answers record-time questions from what had been said by then', () => {
    const afterMoveBeforeTold = new Date(second.saidAt.getTime() - 86_400_000);
    expect(believedHomeAt(p, afterMoveBeforeTold, afterMoveBeforeTold)).toBe(first.city);
    expect(believedHomeAt(p, afterMoveBeforeTold, d('2030-01-01'))).toBe(second.city);
  });
});

describe('questionsFor', () => {
  it('covers every category, with consistent expected answers', () => {
    const p = buildPersona(5, 42);
    const qs = questionsFor(p);
    expect(new Set(qs.map((q) => q.category))).toEqual(
      new Set([
        'cross_session_recall',
        'knowledge_update',
        'temporal_reasoning',
        'single_session_recall',
        'multi_hop',
        'abstention',
      ]),
    );
    for (const q of qs) {
      expect(q.expected, q.question).not.toBe('');
      if (q.validAt && !q.knownAt) expect(q.expected).toBe(homeAt(p, q.validAt));
      if (q.knownAt) expect(q.expected).toBe(believedHomeAt(p, q.validAt ?? q.knownAt, q.knownAt));
      if (q.category === 'abstention') expect(q.expected).toBe(ABSTAIN);
      if (q.sessions === 'first')
        expect(q.askedAt.getTime()).toBeLessThan(p.sessions[1]?.occurredAt.getTime() ?? 0);
    }
  });

  it('asks the record-time question after the move but before it was said', () => {
    const p = buildPersona(1, 42);
    const q = questionsFor(p).find((x) => x.knownAt);
    const second = p.homes[2];
    expect(q?.knownAt?.getTime()).toBeGreaterThan(second?.from?.getTime() ?? 0);
    expect(q?.knownAt?.getTime()).toBeLessThan(second?.saidAt.getTime() ?? 0);
    expect(q?.expected).toBe(p.homes[1]?.city);
  });
});
