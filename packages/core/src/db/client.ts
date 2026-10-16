import postgres from 'postgres';
import type { ISql, Sql, TransactionSql } from 'postgres';

export type { Sql, TransactionSql };

/** Anything queries can run on: a pool or an open transaction. */
export type Queryable = ISql;

export const DEFAULT_DATABASE_URL = 'postgres://engram:engram@localhost:54329/engram';

/** Every Engram connection resolves unqualified names in this order (SPEC §5). */
export const SEARCH_PATH = 'engram, extensions, public';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isLocalUrl(url: string): boolean {
  return LOCAL_HOSTS.has(new URL(url).hostname);
}

export interface DbOptions {
  /** Pool size. */
  max?: number;
  /**
   * Prepared statements. Must be false behind Supabase's transaction-mode
   * pooler, which doesn't support them (SPEC §11).
   */
  prepare?: boolean;
}

/**
 * Opens a pool. Rows come back with camelCase keys, and `undefined` values
 * are sent as NULL.
 */
export function createDb(url: string, options: DbOptions = {}): Sql {
  return postgres(url, {
    max: options.max ?? 10,
    prepare: options.prepare ?? true,
    ssl: isLocalUrl(url) ? false : 'require',
    onnotice: () => undefined,
    connection: { search_path: SEARCH_PATH },
    transform: { ...postgres.camel, undefined: null },
  });
}

/** Runs `fn` in a transaction, or in a savepoint if `db` is already one. */
export async function transaction<T>(
  db: Sql | TransactionSql,
  fn: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  const result = 'savepoint' in db ? db.savepoint(fn) : db.begin(fn);
  return (await result) as T;
}
