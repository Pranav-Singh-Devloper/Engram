import { DEFAULT_DATABASE_URL, connect } from './db.js';

/** Fails fast with a clear hint instead of a wall of ECONNREFUSED errors. */
export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
  const sql = connect(url);
  try {
    await sql`select 1`;
  } catch (err) {
    // postgres.js leaves `message` empty on ECONNREFUSED; the code is the useful part.
    const reason =
      err instanceof Error ? err.message || (err as { code?: string }).code : String(err);
    throw new Error(`Database not reachable at ${url} (${reason}). Run \`pnpm db:up\` first.`, {
      cause: err,
    });
  } finally {
    await sql.end();
  }
}
