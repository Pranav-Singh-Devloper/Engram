// `pnpm bench:lme` — builds the LongMemEval split from the downloaded file:
//   1. download longmemeval_s_cleaned.json to bench/longmemeval/data/ (see README in P08);
//   2. pnpm bench:lme [--n=100] [--seed=7]
// Writes data/longmemeval.json (gitignored; data stays out of git) and
// subset.json (committed: the chosen question ids, for reproducibility).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { SplitFile } from '../dataset/schema.js';
import { RawItem, selectSubset, stratum, toBenchItem } from './adapter.js';

const dir = import.meta.dirname;
const arg = (name: string, fallback: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const source = path.join(dir, 'data', 'longmemeval_s_cleaned.json');
if (!existsSync(source)) {
  throw new Error(
    `Missing ${path.relative(process.cwd(), source)}. Download it from https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned (MIT).`,
  );
}
const n = Number(arg('n', '100'));
const seed = Number(arg('seed', '7'));
const raw = z.array(RawItem).parse(JSON.parse(readFileSync(source, 'utf8')));
const chosen = selectSubset(raw, n, seed);
const items = chosen.map(toBenchItem);

const counts = new Map<string, number>();
for (const r of chosen) counts.set(stratum(r), (counts.get(stratum(r)) ?? 0) + 1);
const file = SplitFile.parse({
  split: 'longmemeval',
  seed,
  generated_at: new Date().toISOString(),
  verbalizer: 'none (LongMemEval-S cleaned, MIT)',
  review: `Stratified ${items.length}-item subset of LongMemEval-S (500): ${[...counts].map(([k, v]) => `${k} ${v}`).join(', ')}.`,
  items,
});
writeFileSync(path.join(dir, 'data', 'longmemeval.json'), `${JSON.stringify(file)}\n`);
writeFileSync(
  path.join(dir, 'subset.json'),
  `${JSON.stringify({ source: 'longmemeval_s_cleaned.json', seed, n, ids: chosen.map((r) => r.question_id) }, null, 2)}\n`,
);
const turns = items.map((i) => i.setup_sessions.reduce((k, s) => k + s.turns.length, 0));
console.log(
  `wrote ${items.length} items (${[...counts].map(([k, v]) => `${k} ${v}`).join(', ')}); ${Math.min(...turns)}-${Math.max(...turns)} turns per history`,
);
