// pnpm bench:label --run=<id> [--n=40] [--seed=1]   writes the sheet you fill in
// pnpm bench:agreement --run=<id>                  reads it back: agreement and κ
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { agreement, parseLabels, renderLabelSheet, sampleForLabels } from './labels.js';
import type { LabelRow } from './labels.js';
import { BENCH_DIR } from './providers.js';
import { loadResults } from './run.js';

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

function main(): void {
  const runId = arg('run');
  if (!runId) throw new Error('Pass --run=<run id>.');
  const runDir = path.join(BENCH_DIR, 'runs', runId);
  const sheetFile = path.join(BENCH_DIR, 'reports', `labels-${runId}.md`);
  // The key holds the judge's verdicts; it lives with the (gitignored) run, not the sheet.
  const keyFile = path.join(runDir, 'labels-key.json');

  if (process.argv.includes('agreement')) {
    if (!existsSync(sheetFile) || !existsSync(keyFile)) throw new Error('Run bench:label first.');
    const rows = JSON.parse(readFileSync(keyFile, 'utf8')) as LabelRow[];
    const labels = parseLabels(readFileSync(sheetFile, 'utf8'));
    const a = agreement(rows, labels);
    const pct = (x: number) => `${Math.round(100 * x)}%`;
    const text = [
      `# Judge agreement — run ${runId}`,
      '',
      `${a.n} of ${rows.length} sampled answers labelled by hand.`,
      '',
      `- Agreement: ${pct(a.agreement)}; Cohen's κ ${a.kappa.toFixed(2)}.`,
      `- Judge too lenient (said correct, human said incorrect): ${a.judgeTooLenient}.`,
      `- Judge too strict (said incorrect, human said correct): ${a.judgeTooStrict}.`,
      '',
    ].join('\n');
    writeFileSync(path.join(BENCH_DIR, 'reports', `agreement-${runId}.md`), text);
    console.log(text);
    return;
  }

  const rows = sampleForLabels(
    loadResults(runDir),
    Number(arg('n') ?? 40),
    Number(arg('seed') ?? 1),
  );
  if (existsSync(sheetFile))
    throw new Error(`${path.basename(sheetFile)} exists; it may hold your labels.`);
  writeFileSync(keyFile, `${JSON.stringify(rows, null, 2)}\n`);
  writeFileSync(sheetFile, renderLabelSheet(rows, runId));
  console.log(
    `wrote ${path.relative(process.cwd(), sheetFile)} with ${rows.length} answers to label`,
  );
}

main();
