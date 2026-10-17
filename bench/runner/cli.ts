// pnpm bench [--split=dev] [--memory=all|engram,rag,...] [--run=<id>] [--limit=N] [--ids=a,b]
//            [--subset=smoke] [--offline] [--record-smoke] [--no-llm-judge] [--report-only]
//            [--extraction=turn|session|packed] [--system=gemini|ollama] [--estimate]
//            [--retrieval-only]   engram: compare rankers on recall@8, no composer calls
//
// --offline       replay recorded responses only (no network, no keys); fails on a miss
// --record-smoke  record the smoke subset's responses into bench/fixtures/smoke-cache
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_DATABASE_URL, createDb } from '@engram/core';
import { PORTABLE, migrate } from '@engram/core/migrate';
import { SplitFile } from '../dataset/schema.js';
import type { BenchItem } from '../dataset/schema.js';
import { describeEstimate, estimate } from './estimate.js';
import { ALL_MODES, EXTRACTIONS, MODES } from './modes.js';
import type { Extraction, Mode } from './modes.js';
import { BENCH_DIR, DEFAULT_CACHE_DIR, loadEnv, makeProviders } from './providers.js';
import { renderReport, summarizeRun } from './report.js';
import { QuotaStop, loadResults, resultFiles, runItems } from './run.js';

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
  const split = arg('split') ?? 'dev';
  // LongMemEval is built locally from downloaded data (pnpm bench:lme); ours are committed.
  const splitPath =
    split === 'longmemeval'
      ? path.join(BENCH_DIR, 'longmemeval', 'data', 'longmemeval.json')
      : path.join(BENCH_DIR, 'dataset', `${split}.json`);
  const file = SplitFile.parse(JSON.parse(readFileSync(splitPath, 'utf8')));
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
  for (const m of modes) if (!ALL_MODES.includes(m)) throw new Error(`Unknown mode ${m}`);
  const extraction = (arg('extraction') ?? 'turn') as Extraction;
  if (!EXTRACTIONS.includes(extraction)) throw new Error(`Unknown extraction ${extraction}`);

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
    console.log(describeEstimate(estimate(items, modes, llmJudge, extraction), geminiRpm));
    if (flag('estimate')) return;
    const system = arg('system') ?? 'gemini';
    if (system !== 'gemini' && system !== 'ollama') throw new Error(`Unknown system ${system}`);
    const embeddings = arg('embeddings') ?? 'local';
    if (embeddings !== 'local' && embeddings !== 'gemini') {
      throw new Error(`Unknown embeddings ${embeddings}`);
    }
    const providers = makeProviders({
      system,
      embeddings,
      cacheDir,
      mode: offline ? 'readonly' : 'readwrite',
      fallbackCacheDir: recordSmoke ? DEFAULT_CACHE_DIR : undefined,
    });
    const db = createDb(process.env.DATABASE_URL || DEFAULT_DATABASE_URL, { max: 4 });
    try {
      await migrate(db, { sources: [PORTABLE] });
      await runItems(items, modes, {
        db,
        provider: providers.system,
        judge: llmJudge ? providers.judge : undefined,
        meter: providers.meter,
        recall: {
          ...(process.env.BENCH_RANKER
            ? { ranker: process.env.BENCH_RANKER as 'rrf' | 'linear' }
            : {}),
          ...(process.env.BENCH_FLOOR ? { floor: Number(process.env.BENCH_FLOOR) } : {}),
          ...(arg('self-prior') ? { selfWeight: Number(arg('self-prior')) } : {}),
        },
        retrievalOnly: flag('retrieval-only'),
        extraction,
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
  const meta = {
    runId,
    split,
    model:
      arg('system') === 'ollama'
        ? `ollama ${process.env.OLLAMA_MODEL || 'qwen3.5:9b'}`
        : process.env.GEMINI_CHAT_MODEL || 'gemini-3.5-flash-lite',
    judge: llmJudge ? process.env.JUDGE_MODEL || 'openai/gpt-oss-120b' : 'exact/contains only',
    // The run's own date when its id carries one, so --report-only keeps it.
    date: /^\d{4}-\d{2}-\d{2}/.exec(runId)?.[0] ?? new Date().toISOString().slice(0, 10),
  };
  const report = renderReport(results, meta);
  if (!smoke) {
    mkdirSync(path.dirname(reportFile), { recursive: true });
    writeFileSync(reportFile, report);
    const finishedAt = new Date(
      Math.max(0, ...resultFiles(runDir).map((f) => statSync(f).mtimeMs)),
    ).toISOString();
    writeFileSync(
      reportFile.replace(/\.md$/, '.json'),
      `${JSON.stringify(summarizeRun(results, { ...meta, finishedAt }), null, 2)}\n`,
    );
  }
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
