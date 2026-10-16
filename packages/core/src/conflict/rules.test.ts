// Pure table tests for the rule fast-path: every branch of classify() and
// fromAdjudication(), with hand-built rows and no database.
import { describe, expect, it } from 'vitest';
import { UNKNOWN_START } from '../db/client.js';
import { fakeEmbedding } from '../providers/fake.js';
import { getPredicate } from './predicates.js';
import type { PredicateSpec } from './predicates.js';
import { classify, fromAdjudication } from './rules.js';
import type { Belief, CandidateView } from './rules.js';

const y = (year: number, month = 1) => new Date(Date.UTC(year, month - 1, 1));
const livesIn = getPredicate('lives_in');
const birthDate = getPredicate('birth_date');
const likes = getPredicate('likes');

let n = 0;
function fact(over: Partial<Belief> & { object: string }): Belief {
  const { object, ...rest } = over;
  const statement = `The user lives in ${object}.`;
  return {
    id: `fact-${++n}`,
    namespaceId: 'ns',
    subjectId: 'self',
    predicate: 'lives_in',
    predicateAdHoc: false,
    objectId: `entity-${object}`,
    objectLiteral: null,
    objectName: object,
    statement,
    embedding: fakeEmbedding(statement),
    confidence: 0.9,
    importance: 0.5,
    pinned: false,
    accessScore: 0,
    lastAccessedAt: null,
    validFrom: y(2020),
    validFromSource: 'episode',
    validTo: null,
    recordedAt: y(2024),
    invalidatedAt: null,
    revises: null,
    supersededBy: null,
    status: 'active',
    tier: 'working',
    sourceEpisodeIds: ['ep-1'],
    createdAt: y(2024),
    ...rest,
  };
}

function cand(over: Partial<CandidateView> & { object: string }): CandidateView {
  const { object, ...rest } = over;
  return {
    objectId: `entity-${object}`,
    objectLiteral: null,
    objectName: object,
    embedding: fakeEmbedding(`The user lives in ${object}.`),
    validFrom: y(2024, 6),
    validFromSource: 'episode',
    validTo: null,
    isCorrection: false,
    confidence: 0.9,
    ...rest,
  };
}

function kind(c: CandidateView, existing: Belief[], spec: PredicateSpec | undefined = livesIn) {
  return classify(c, existing, spec).kind;
}

describe('classify', () => {
  it('inserts when there are no current beliefs', () => {
    expect(kind(cand({ object: 'Paris' }), [])).toBe('insert');
  });

  it('merges a restatement of the same entity in an overlapping window', () => {
    const paris = fact({ object: 'Paris' });
    const d = classify(cand({ object: 'Paris' }), [paris], livesIn);
    expect(d).toMatchObject({ kind: 'merge', target: { id: paris.id }, resolver: 'rule' });
  });

  it('merges an adjacent window of the same value', () => {
    const lyon = fact({ object: 'Lyon', validFrom: y(2015), validTo: y(2018) });
    expect(kind(cand({ object: 'Lyon', validFrom: y(2018), validTo: y(2019) }), [lyon])).toBe(
      'merge',
    );
  });

  it('merges a literal with an entity of the same name', () => {
    const literal = fact({ object: 'Toronto', objectId: null, objectLiteral: 'Toronto' });
    expect(kind(cand({ object: 'toronto' }), [literal])).toBe('merge');
  });

  it('merges literals by normalized value or paraphrase, but never entities by embedding', () => {
    const literal = (value: string, statement: string) =>
      fact({
        object: value,
        objectId: null,
        objectLiteral: value,
        statement,
        embedding: fakeEmbedding(statement),
        predicate: 'likes',
      });
    const jazz = literal('Jazz', 'The user likes jazz.');
    const view = (value: string, statement: string) =>
      cand({
        object: value,
        objectId: null,
        objectLiteral: value,
        embedding: fakeEmbedding(statement),
      });
    expect(kind(view('  jazz ', 'x'), [jazz], likes)).toBe('merge');
    expect(kind(view('jazz music', 'The user likes jazz.'), [jazz], likes)).toBe('merge');
    expect(kind(view('techno', 'The user likes techno.'), [jazz], likes)).toBe('coexist');

    // Near-identical statements about different entities stay different.
    const bern = fact({ object: 'Bern', statement: 'The user lives in Bern.' });
    const d = classify(
      cand({ object: 'Berlin', embedding: fakeEmbedding('The user lives in Bern.') }),
      [bern],
      livesIn,
    );
    expect(d.kind).not.toBe('merge');
  });

  it('lets multi-valued predicates coexist, and ad-hoc ones default to that', () => {
    const jazz = fact({ object: 'jazz', predicate: 'likes' });
    expect(kind(cand({ object: 'techno' }), [jazz], likes)).toBe('coexist');
    // classify directly: passing undefined to kind() would pick up its default spec.
    expect(classify(cand({ object: 'Ana' }), [fact({ object: 'Rui' })], undefined).kind).toBe(
      'coexist',
    );
  });

  it('sends a correction cue on a multi-valued predicate to the adjudicator', () => {
    const d = classify(
      cand({ object: 'techno', isCorrection: true }),
      [fact({ object: 'jazz' })],
      likes,
    );
    expect(d).toMatchObject({
      kind: 'adjudicate',
      allowed: ['update', 'correction', 'coexist', 'reject'],
    });
  });

  it('updates the open value when a new one starts later', () => {
    const paris = fact({ object: 'Paris', validFrom: y(2024, 1) });
    const d = classify(cand({ object: 'Berlin', validFrom: y(2024, 3) }), [paris], livesIn);
    expect(d).toMatchObject({ kind: 'update', target: { id: paris.id } });
  });

  it('retracts on a correction cue, even when the candidate starts later', () => {
    const initech = fact({ object: 'Initech', predicate: 'works_at' });
    const d = classify(
      cand({ object: 'Acme', isCorrection: true }),
      [initech],
      getPredicate('works_at'),
    );
    expect(d).toMatchObject({ kind: 'correction', target: { id: initech.id } });
  });

  it('rejects a low-confidence candidate against a confident fact', () => {
    const paris = fact({ object: 'Paris', confidence: 0.9 });
    expect(kind(cand({ object: 'Rome', confidence: 0.3 }), [paris])).toBe('reject');
    // Not noise when the existing fact is itself weak.
    expect(
      kind(cand({ object: 'Rome', confidence: 0.3 }), [fact({ object: 'Paris', confidence: 0.5 })]),
    ).toBe('update');
  });

  it('backfills closed history that precedes the open value', () => {
    const berlin = fact({ object: 'Berlin', validFrom: y(2020) });
    const d = classify(
      cand({ object: 'Paris', validFrom: y(2018), validTo: y(2020) }),
      [berlin],
      livesIn,
    );
    expect(d).toMatchObject({ kind: 'backfill', successor: { id: berlin.id }, validTo: y(2020) });
  });

  it('ends an open-ended earlier candidate where known history begins', () => {
    const berlin = fact({ object: 'Berlin', validFrom: y(2020) });
    const d = classify(
      cand({ object: 'Lyon', validFrom: y(2015), validFromSource: 'explicit' }),
      [berlin],
      livesIn,
    );
    expect(d).toMatchObject({ kind: 'backfill', validTo: y(2020) });
  });

  it('backfills an unknown-start fact before the earliest known row', () => {
    const lyon = fact({ object: 'Lyon', validFrom: y(2015), validTo: y(2018) });
    const paris = fact({ object: 'Paris', validFrom: y(2018) });
    const d = classify(
      cand({
        object: 'Marseille',
        validFrom: UNKNOWN_START,
        validFromSource: 'unknown',
        validTo: y(2015),
      }),
      [paris, lyon],
      livesIn,
    );
    expect(d).toMatchObject({ kind: 'backfill', successor: { id: lyon.id } });
  });

  it('adjudicates a backfill that overlaps closed history (§7.4 case 13)', () => {
    const lyon = fact({ object: 'Lyon', validFrom: y(2015), validTo: y(2018) });
    const berlin = fact({ object: 'Berlin', validFrom: y(2020) });
    const d = classify(
      cand({ object: 'Rome', validFrom: y(2017), validTo: y(2019) }),
      [lyon, berlin],
      livesIn,
    );
    expect(d).toMatchObject({ kind: 'adjudicate', reason: 'overlaps closed history' });
  });

  it('adjudicates a candidate starting at the same time as the open value', () => {
    const paris = fact({ object: 'Paris', validFrom: y(2024, 6) });
    expect(kind(cand({ object: 'Berlin', validFrom: y(2024, 6) }), [paris])).toBe('adjudicate');
  });

  it('adjudicates a closed window inside the open value', () => {
    const paris = fact({ object: 'Paris', validFrom: y(2018) });
    expect(
      kind(cand({ object: 'Rome', validFrom: y(2024, 1), validTo: y(2024, 3) }), [paris]),
    ).toBe('adjudicate');
  });

  it('never updates or backfills a static predicate (§7.4 case 6)', () => {
    const born = fact({ object: '1990-07-04', predicate: 'birth_date', validFrom: y(2024, 1) });
    const later = cand({ object: '1991-07-04', validFrom: y(2024, 6) });
    expect(classify(later, [born], birthDate)).toMatchObject({
      kind: 'adjudicate',
      allowed: ['correction', 'reject'],
    });
    expect(kind({ ...later, isCorrection: true }, [born], birthDate)).toBe('correction');
  });
});

describe('fromAdjudication', () => {
  const paris = fact({ object: 'Paris', validFrom: y(2024, 1) });
  const c = cand({ object: 'Berlin', validFrom: y(2024, 6) });
  const out = (
    decision: 'update' | 'correction' | 'coexist' | 'reject',
    targetFactId: string | null = paris.id,
  ) => ({
    decision,
    targetFactId,
    reason: 'because',
    flagPredicate: false,
  });
  const all = ['update', 'correction', 'coexist', 'reject'] as const;

  it('maps each decision onto the row mechanics, marked as llm', () => {
    expect(fromAdjudication(out('update'), c, [paris], all)).toMatchObject({
      kind: 'update',
      resolver: 'llm',
    });
    expect(fromAdjudication(out('correction'), c, [paris], all)).toMatchObject({
      kind: 'correction',
    });
    expect(fromAdjudication(out('coexist', null), c, [paris], all)).toMatchObject({
      kind: 'coexist',
    });
    expect(fromAdjudication(out('reject'), c, [paris], all)).toMatchObject({
      kind: 'reject',
      target: { id: paris.id },
    });
  });

  it('turns a disallowed decision into a reject', () => {
    expect(fromAdjudication(out('update'), c, [paris], ['correction', 'reject'])).toMatchObject({
      kind: 'reject',
    });
  });

  it('keeps both when an update cannot apply', () => {
    const early = cand({ object: 'Berlin', validFrom: y(2023) });
    expect(fromAdjudication(out('update'), early, [paris], all).kind).toBe('coexist');
  });

  it('records a flagged predicate in the reason', () => {
    const d = fromAdjudication({ ...out('coexist', null), flagPredicate: true }, c, [paris], all);
    expect(d.reason).toContain('predicate flagged');
  });
});
