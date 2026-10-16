// pnpm bench [--split=dev] [--memory=all|engram,rag,...] [--run=<id>] [--limit=N] [--ids=a,b]
//            [--subset=smoke] [--offline] [--record-smoke] [--no-llm-judge] [--report-only]
//
// --offline       replay recorded responses only (no network, no keys); fails on a miss
// --record-smoke  record the smoke subset's responses into bench/fixtures/smoke-cache
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_DATABASE_URL, createDb } from '@engram/core';
import { PORTABLE, migrate } from '@engram/core/migrate';
import { SplitFile } from '../dataset/schema.js';
import type { BenchItem } from '../dataset/schema.js';
import { describeEstimate, estimate } from './estimate.js';
import { MODES } from './modes.js';
import type { Mode } from './modes.js';
import { BENCH_DIR, DEFAULT_CACHE_DIR, loadEnv, makeProviders } from './providers.js';
import { renderReport } from './report.js';
import { QuotaStop, loadResults, runItems } from './run.js';

export const SMOKE_CACHE_DIR = path.join(BENCH_DIR, 'fixtures', 'smoke-cache');
export const SMOKE_SIZE = 20;

const flag = (name: string) => process.argv.includes(`--${name}`);
function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

/** 20 dev items with deterministic judges, from as few personas as possible (shared cache). */
export function smokeItems(items: readonly BenchItem[]): BenchItem[] {
  return items
    .filter((i) => i.judge !== 'llm')
    .sort(
      (a, b) =>
        a.persona.localeCompare(b.persona, 'en', { numeric: true }) || a.id.localeCompare(b.id),
    )
    .slice(0, SMOKE_SIZE);
}

async function main(): Promise<void> {
  loadEnv();
  const split = (arg('split') ?? 'dev') as 'dev' | 'test';
  const file = SplitFile.parse(
    JSON.parse(readFileSync(path.join(BENCH_DIR, 'dataset', `${split}.json`), 'utf8')),
  );
  const offline = flag('offline');
  const recordSmoke = flag('record-smoke');
  const smoke = recordSmoke || arg('subset') === 'smoke';

  let items = smoke ? smokeItems(file.items) : file.items;
  const ids = arg('ids')?.split(',');
  if (ids) items = items.filter((i) => ids.includes(i.id));
  const limit = Number(arg('limit') ?? 0);
  if (limit > 0) items = items.slice(0, limit);

  const memory = arg('memory') ?? 'all';
  const modes = (memory === 'all' ? [...MODES] : memory.split(',')) as Mode[];
  for (const m of modes) if (!MODES.includes(m)) throw new Error(`Unknown mode ${m}`);

  const runId =
    arg('run') ?? `${new Date().toISOString().slice(0, 10)}-${split}${smoke ? '-smoke' : ''}`;
  const runDir = path.join(BENCH_DIR, 'runs', runId);
  const llmJudge = !flag('no-llm-judge') && !offline && !smoke;
  const cacheDir = smoke ? SMOKE_CACHE_DIR : (arg('cache-dir') ?? DEFAULT_CACHE_DIR);
  const reportFile = path.join(BENCH_DIR, 'reports', `${runId}.md`);

  if (!flag('report-only')) {
    const geminiRpm = Number(process.env.BENCH_RPM_GEMINI ?? 12) || 12;
    console.log(
      `${items.length} items × ${modes.length} modes, run ${runId}${offline ? ' (offline replay)' : ''}`,
    );
    console.log(describeEstimate(estimate(items, modes, llmJudge), geminiRpm));
    const providers = makeProviders({ cacheDir, mode: offline ? 'readonly' : 'readwrite' });
    const db = createDb(process.env.DATABASE_URL || DEFAULT_DATABASE_URL, { max: 4 });
    try {
      await migrate(db, { sources: [PORTABLE] });
      await runItems(items, modes, {
        db,
        provider: providers.gemini,
        judge: llmJudge ? providers.judge : undefined,
        meter: providers.meter,
        dir: runDir,
        log: (line) => {
          console.log(line);
        },
      });
    } catch (err) {
      if (!(err instanceof QuotaStop)) throw err;
      console.error(err.message);
      process.exitCode = 2;
    } finally {
      await db.end();
    }
  }

  const wanted = new Set(items.map((i) => i.id));
  const results = loadResults(runDir).filter((r) => wanted.has(r.itemId) && modes.includes(r.mode));
  const report = renderReport(results, {
    runId,
    split,
    model: process.env.GEMINI_CHAT_MODEL || 'gemini-3.5-flash-lite',
    judge: llmJudge ? process.env.JUDGE_MODEL || 'openai/gpt-oss-120b' : 'exact/contains only',
    date: new Date().toISOString().slice(0, 10),
  });
  if (!smoke) writeFileSync(reportFile, report);
  console.log(`\n${report.split('## Abstention')[0] ?? ''}`);
  if (!smoke) console.log(`Report: ${path.relative(process.cwd(), reportFile)}`);

  if (smoke) {
    const expected = items.length * modes.length;
    if (results.length !== expected) {
      console.error(`Smoke run produced ${results.length} of ${expected} results.`);
      process.exitCode = 1;
    }
  }
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
