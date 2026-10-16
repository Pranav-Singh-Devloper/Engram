import path from 'node:path';
import type { MigrationSource } from './migrator.js';

export const REPO_ROOT = path.resolve(import.meta.dirname, '..');

/** Portable SQL, applied to every database (SPEC §3). */
export const PORTABLE: MigrationSource = {
  dir: path.join(REPO_ROOT, 'supabase/migrations'),
  prefix: 'migrations',
};

/** Supabase-only SQL (pg_cron, role revokes), applied only by `db:migrate:hosted`. */
export const HOSTED: MigrationSource = {
  dir: path.join(REPO_ROOT, 'supabase/hosted'),
  prefix: 'hosted',
};
