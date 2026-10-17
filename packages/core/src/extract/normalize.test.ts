import { describe, expect, it } from 'vitest';
import { PREDICATES } from '../conflict/predicates.js';
import { cleanName, normalizeName, normalizePredicate, toSnakeCase } from './normalize.js';

describe('normalizePredicate', () => {
  it.each([
    ['lives_in', 'lives_in'],
    ['resides_in', 'lives_in'],
    ['based in', 'lives_in'],
    ['Moved-To', 'lives_in'],
    ['movedTo', 'lives_in'],
    ['employedBy', 'works_at'],
    ['employed_by', 'works_at'],
    ['Job at', 'works_at'],
    ['born_on', 'birth_date'],
    ['is_allergic_to', 'allergic_to'],
    ['has_occupation', 'occupation'],
    ['sister_of', 'sibling_of'],
  ])('maps %s to the registry name %s', (raw, expected) => {
    expect(normalizePredicate(raw)).toEqual({ predicate: expected, adHoc: false });
  });

  it('flags predicates outside the registry as ad hoc, in snake_case', () => {
    expect(normalizePredicate('Collects Stamps From')).toEqual({
      predicate: 'collects_stamps_from',
      adHoc: true,
    });
  });

  it('rejects a predicate with no usable characters', () => {
    expect(() => normalizePredicate(' -- ')).toThrow(/empty/);
  });

  it('has no synonym shared between two predicates or shadowing a name', () => {
    const names = PREDICATES.map((p) => p.name);
    const synonyms = PREDICATES.flatMap((p) => p.synonyms);
    expect(new Set(synonyms).size).toBe(synonyms.length);
    expect(synonyms.filter((s) => names.includes(s))).toEqual([]);
  });
});

describe('name normalization', () => {
  it('collapses whitespace and case for comparison, keeping case for storage', () => {
    expect(cleanName('  São   Paulo ')).toBe('São Paulo');
    expect(normalizeName('  São   PAULO ')).toBe('são paulo');
  });

  it('strips diacritics only from predicates', () => {
    expect(toSnakeCase('Café owner of')).toBe('cafe_owner_of');
  });
});
