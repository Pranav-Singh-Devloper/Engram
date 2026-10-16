import { lookupPredicate } from '../conflict/predicates.js';

/** "Resides In" → "resides_in"; diacritics dropped, punctuation collapsed. */
export function toSnakeCase(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export interface NormalizedPredicate {
  predicate: string;
  /** True when the predicate isn't in the registry, even via a synonym. */
  adHoc: boolean;
}

export function normalizePredicate(raw: string): NormalizedPredicate {
  const snake = toSnakeCase(raw);
  if (snake === '') throw new Error(`Predicate "${raw}" is empty after normalization.`);
  const spec = lookupPredicate(snake);
  return spec ? { predicate: spec.name, adHoc: false } : { predicate: snake, adHoc: true };
}

/** Entity names are compared case-insensitively with whitespace collapsed. */
export function normalizeName(name: string): string {
  return cleanName(name).toLowerCase();
}

/** How entity names and aliases are stored: trimmed, whitespace collapsed, case kept. */
export function cleanName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ');
}
