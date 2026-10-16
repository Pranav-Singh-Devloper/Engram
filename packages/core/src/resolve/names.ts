// A lexical guard for embedding matches between entities. Labels embed
// "name (type): description", and a generic description ("the company the
// user works for") can make two different names look alike; the bench
// caught Initech being folded into Acme Robotics that way. The embedding rung
// may only match names that could plausibly denote the same thing.
import { normalizeName } from '../extract/normalize.js';

const STOPWORDS = new Set([
  'the',
  'of',
  'and',
  'a',
  'an',
  'my',
  'de',
  'la',
  'le',
  'inc',
  'ltd',
  'co',
  'corp',
  'llc',
]);

function tokens(name: string): string[] {
  return normalizeName(name)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

/**
 * True when one name could be a variant of the other: one contains the other
 * ("Acme" / "Acme Robotics"), a word-prefix ("Rob" / "Robert"), a shared
 * distinctive word ("Acme Corp" / "Acme Corporation"), or initials ("NYC" /
 * "New York City").
 */
export function namesCompatible(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  const ja = ta.join(' ');
  const jb = tb.join(' ');
  if (ja === jb || ja.includes(jb) || jb.includes(ja)) return true;

  const distinct = (ts: string[]) => ts.filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  const da = distinct(ta);
  const db = distinct(tb);
  if (da.some((x) => db.some((y) => x === y || x.startsWith(y) || y.startsWith(x)))) return true;

  const initials = (ts: string[]) =>
    ts
      .filter((t) => !STOPWORDS.has(t))
      .map((t) => t[0])
      .join('');
  const single = (ts: string[], other: string[]) =>
    ts.length === 1 && other.length > 1 && ts[0] === initials(other);
  return single(ta, tb) || single(tb, ta);
}
