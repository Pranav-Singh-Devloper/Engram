import { DEFAULT_DATABASE_URL, createDb } from '../db/client.js';
import { PORTABLE, migrate } from '../db/migrate.js';

/**
 * Vitest global setup for integration tests: fails fast with a clear hint if
 * the local database is down, then brings its schema up to date so tests
 * never run against stale migrations.
 */
export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
  const sql = createDb(url, { max: 1 });
  try {
    await sql`select 1`;
  } catch (err) {
    // postgres.js leaves `message` empty on ECONNREFUSED; the code is the useful part.
    const reason =
      err instanceof Error ? err.message || (err as { code?: string }).code : String(err);
    await sql.end();
    throw new Error(`Database not reachable at ${url} (${reason}). Run \`pnpm db:up\` first.`, {
      cause: err,
    });
  }
  try {
    await migrate(sql, { sources: [PORTABLE] });
  } finally {
    await sql.end();
  }
}
