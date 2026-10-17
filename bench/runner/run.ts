// Runs items through memory modes and writes one result file per (mode, item)
// under bench/runs/<runId>/ (SPEC §13.3). Existing results are skipped, so an
// interrupted run resumes where it stopped. A rate limit that outlasts the
// backoff (a daily quota) stops the run cleanly instead of failing items.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ProviderHttpError } from '@engram/core';
import type { Provider, Sql } from '@engram/core';
import type { BenchItem } from '../dataset/schema.js';
import type { Usage, UsageMeter } from './cache.js';
import { emptyUsage } from './cache.js';
import { judgeAnswer } from './judge.js';
import type { Verdict } from './judge.js';
import { runMode } from './modes.js';
import type { Mode, ModeAnswer, ModeDeps } from './modes.js';

export interface ItemResult {
  itemId: string;
  mode: Mode;
  category: BenchItem['category'];
  persona: string;
  question: string;
  expected: string;
  answer: ModeAnswer;
  verdict: Verdict;
  /** What the system under test spent; the judge's calls are excluded. */
  usage: Usage;
  latencyMs: number;
}

export interface RunOptions {
  db: Sql;
  provider: Provider;
  recall?: ModeDeps['recall'];
  retrievalOnly?: boolean;
  judge?: Pick<Provider, 'judge'>;
  meter?: UsageMeter;
  dir: string;
  log?: (line: string) => void;
}

export class QuotaStop extends Error {
  override name = 'QuotaStop';
}

export function resultPath(dir: string, mode: Mode, itemId: string): string {
  return path.join(dir, mode, `${itemId}.json`);
}

export async function runItems(
  items: readonly BenchItem[],
  modes: readonly Mode[],
  options: RunOptions,
): Promise<number> {
  const log = options.log ?? (() => undefined);
  let ran = 0;
  for (const mode of modes) {
    mkdirSync(path.join(options.dir, mode), { recursive: true });
    for (const item of items) {
      const file = resultPath(options.dir, mode, item.id);
      if (existsSync(file)) continue;
      options.meter?.take();
      const started = performance.now();
      let answer: ModeAnswer;
      try {
        answer = await runMode(mode, item, {
          db: options.db,
          provider: options.provider,
          recall: options.recall,
          retrievalOnly: options.retrievalOnly,
        });
      } catch (err) {
        if (err instanceof ProviderHttpError && err.status === 429) {
          throw new QuotaStop(
            `Rate limit outlasted the backoff at ${mode}/${item.id}; the run is resumable. ${err.message.slice(0, 200)}`,
          );
        }
        throw err;
      }
      const latencyMs = Math.round(performance.now() - started);
      const usage = options.meter?.take() ?? emptyUsage();
      const verdict = await judgeAnswer(item, answer, options.judge);
      options.meter?.take();
      const result: ItemResult = {
        itemId: item.id,
        mode,
        category: item.category,
        persona: item.persona,
        question: item.question,
        expected: item.expected,
        answer,
        verdict,
        usage,
        latencyMs,
      };
      writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
      ran++;
      log(
        `${verdict.correct ? '✓' : '✗'} ${mode.padEnd(12)} ${item.id} ${item.question} → ${answer.answer}`,
      );
    }
  }
  return ran;
}

export function loadResults(dir: string): ItemResult[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as ItemResult);
}
