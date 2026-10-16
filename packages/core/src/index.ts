export const ENGRAM_VERSION = '0.0.0';

export {
  DEFAULT_DATABASE_URL,
  SEARCH_PATH,
  createDb,
  isLocalUrl,
  transaction,
} from './db/client.js';
export type { DbOptions, Queryable, Sql, TransactionSql } from './db/client.js';
