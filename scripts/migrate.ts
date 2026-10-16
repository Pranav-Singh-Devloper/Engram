import { existsSync } from 'node:fs';
import path from 'node:path';
import { createDb } from '@engram/core';
import { HOSTED, PORTABLE, dropSchemas, migrate } from '@engram/core/migrate';
import { resolveTarget } from './target.js';

const envFile = path.resolve(import.meta.dirname, '../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

async function main(): Promise<void> {
  const target = resolveTarget(process.argv.slice(2), process.env);
  const sql = createDb(target.url, { max: 1 });
  try {
    if (target.reset) {
      await dropSchemas(sql, ['engram', 'extensions']);
      console.log('dropped schemas engram, extensions');
    }
    const applied = await migrate(sql, {
      sources: target.hosted ? [PORTABLE, HOSTED] : [PORTABLE],
      log: (m) => {
        console.log(m);
      },
    });
    console.log(applied.length === 0 ? 'up to date' : `${applied.length} migration(s) applied`);
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
