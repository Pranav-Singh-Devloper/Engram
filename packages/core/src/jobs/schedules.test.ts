import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { config } from '../config/index.js';
import { HOSTED } from '../db/migrate.js';
import { CRON_SCHEDULES_FILE, cronSchedulesSql } from './schedules.js';

describe('hosted cron schedules', () => {
  it('match the committed file (run `pnpm db:hosted-cron` after changing config)', () => {
    const committed = readFileSync(path.join(HOSTED.dir, CRON_SCHEDULES_FILE), 'utf8');
    expect(committed).toBe(cronSchedulesSql());
  });

  it("use the config's decay parameters, static predicates and schedules", () => {
    const sql = cronSchedulesSql({
      ...config,
      decay: { ...config.decay, tauWorkingDays: 7 },
      schedules: { decaySweep: '0 4 * * *', demoCleanup: '*/30 * * * *' },
    } as unknown as typeof config);
    expect(sql).toContain('now(), 7::double precision, 90::double precision');
    expect(sql).toContain("array['birth_date', 'is_named', 'sibling_of']::text[]");
    expect(sql).toContain("'0 4 * * *'");
    expect(sql).toContain("'*/30 * * * *'");
  });

  it('is a repeatable hosted-only file, so the local runner never sees it', () => {
    expect(CRON_SCHEDULES_FILE.startsWith('R__')).toBe(true);
    expect(path.basename(HOSTED.dir)).toBe('hosted');
  });
});
