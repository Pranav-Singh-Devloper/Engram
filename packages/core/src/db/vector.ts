import { EMBEDDING_DIM } from '../config/index.js';

export function assertVector(v: readonly number[]): void {
  if (v.length !== EMBEDDING_DIM) {
    throw new Error(`Expected a ${EMBEDDING_DIM}-dim vector, got ${v.length}.`);
  }
  if (!v.every(Number.isFinite)) {
    throw new Error('Vector contains a non-finite value.');
  }
}

/** pgvector's text format, e.g. `[0.1,0.2]`. Postgres casts it to `vector` from context. */
export function toSql(v: readonly number[]): string {
  assertVector(v);
  return `[${v.join(',')}]`;
}

export function fromSql(text: string): number[] {
  const v = JSON.parse(text) as unknown;
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'number')) {
    throw new Error('Not a pgvector value.');
  }
  assertVector(v);
  return v;
}

export function l2Normalize(v: readonly number[]): number[] {
  const norm = Math.hypot(...v);
  if (norm === 0) throw new Error('Cannot normalize a zero vector.');
  return v.map((x) => x / norm);
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new Error('Vectors differ in length.');
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return dot / Math.sqrt(na * nb);
}
