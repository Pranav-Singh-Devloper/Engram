import { randomUUID } from 'node:crypto';
import { DEFAULT_DATABASE_URL, createDb } from '../db/client.js';
import type { Sql } from '../db/client.js';
import { ensureNamespace } from '../db/namespaces.js';
import type { NamespaceWithSelf } from '../db/namespaces.js';

/** A pool on the local test database. Callers `end()` it in `afterAll`. */
export function testDb(): Sql {
  return createDb(process.env.DATABASE_URL || DEFAULT_DATABASE_URL, { max: 4 });
}

/**
 * Runs `fn` against a fresh namespace and deletes it afterwards. Namespaces
 * are the isolation boundary, so tests can share one database and run in parallel.
 */
export async function withTestNamespace<T>(
  db: Sql,
  fn: (ns: NamespaceWithSelf) => Promise<T>,
): Promise<T> {
  const ns = await ensureNamespace(db, { slug: `test-${randomUUID()}` });
  try {
    return await fn(ns);
  } finally {
    await db`delete from namespaces where id = ${ns.namespace.id}`;
  }
}

/** A deterministic unit-ish test vector: `value` at `index`, zeros elsewhere. */
export function basisVector(index: number, value = 1): number[] {
  const v = new Array<number>(768).fill(0);
  v[index] = value;
  return v;
}
