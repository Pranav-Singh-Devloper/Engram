// `pnpm db:hosted-cron`: regenerates supabase/hosted/R__cron_schedules.sql
// from config. `--check` exits non-zero if the committed file is stale.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CRON_SCHEDULES_FILE, cronSchedulesSql } from '@engram/core';
import { HOSTED } from '@engram/core/migrate';

const file = path.join(HOSTED.dir, CRON_SCHEDULES_FILE);
const sql = cronSchedulesSql();
let current = '';
try {
  current = readFileSync(file, 'utf8');
} catch {
  // Not generated yet.
}

if (process.argv.includes('--check')) {
  if (current !== sql) {
    console.error(`${CRON_SCHEDULES_FILE} is stale; run \`pnpm db:hosted-cron\`.`);
    process.exitCode = 1;
  }
} else if (current === sql) {
  console.log(`${CRON_SCHEDULES_FILE} is up to date`);
} else {
  writeFileSync(file, sql);
  console.log(`wrote supabase/hosted/${CRON_SCHEDULES_FILE}`);
}
