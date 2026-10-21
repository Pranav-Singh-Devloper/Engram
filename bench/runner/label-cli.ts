// pnpm bench:label --run=<id> [--n=40] [--seed=1]   writes the sheet you fill in
// pnpm bench:agreement --run=<id>[,<id>…]          reads them back: agreement and κ, pooled too
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  agreementOf,
  labelPairs,
  parseLabels,
  renderLabelSheet,
  sampleForLabels,
} from './labels.js';
import type { Agreement, LabelPair, LabelRow } from './labels.js';
import { BENCH_DIR } from './providers.js';
import { loadResults } from './run.js';

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const pct = (x: number) => `${Math.round(100 * x)}%`;

function describe(a: Agreement, sampled: number): string[] {
  const kappa =
    a.kappa === null
      ? "Cohen's κ undefined (every label is one class, so only agreement is meaningful)"
      : `Cohen's κ ${a.kappa.toFixed(2)}`;
  return [
    `${a.n} of ${sampled} sampled answers labelled by hand: ${a.humanCorrect} correct, ${a.humanIncorrect} incorrect.`,
    '',
    `- Agreement: ${pct(a.agreement)}; ${kappa}.`,
    `- Judge too lenient (said correct, human said incorrect): ${a.judgeTooLenient}.`,
    `- Judge too strict (said incorrect, human said correct): ${a.judgeTooStrict}.`,
  ];
}

function main(): void {
  const runIds = (arg('run') ?? '').split(',').filter(Boolean);
  if (runIds.length === 0) throw new Error('Pass --run=<run id>[,<run id>…].');
  const files = (runId: string) => ({
    sheet: path.join(BENCH_DIR, 'reports', `labels-${runId}.md`),
    // The key holds the judge's verdicts; it lives with the (gitignored) run, not the sheet.
    key: path.join(BENCH_DIR, 'runs', runId, 'labels-key.json'),
  });

  if (process.argv.includes('agreement')) {
    const sections: string[] = [];
    const perRun: Record<string, Agreement> = {};
    const all: LabelPair[] = [];
    let sampled = 0;
    for (const runId of runIds) {
      const f = files(runId);
      if (!existsSync(f.sheet) || !existsSync(f.key))
        throw new Error(`Run bench:label --run=${runId} first.`);
      const rows = JSON.parse(readFileSync(f.key, 'utf8')) as LabelRow[];
      const pairs = labelPairs(rows, parseLabels(readFileSync(f.sheet, 'utf8')));
      all.push(...pairs);
      sampled += rows.length;
      perRun[runId] = agreementOf(pairs);
      sections.push(`## ${runId}`, '', ...describe(agreementOf(pairs), rows.length), '');
    }
    const name = runIds.join('+');
    const text = [
      `# Judge agreement — ${name}`,
      '',
      ...(runIds.length > 1 ? ['## Pooled', '', ...describe(agreementOf(all), sampled), ''] : []),
      ...sections,
    ].join('\n');
    writeFileSync(path.join(BENCH_DIR, 'reports', `agreement-${name}.md`), text);
    // The eval dashboard reads this (P09b).
    writeFileSync(
      path.join(BENCH_DIR, 'reports', `agreement-${name}.json`),
      `${JSON.stringify({ runs: runIds, pooled: agreementOf(all), perRun }, null, 2)}\n`,
    );
    console.log(text);
    return;
  }

  const runId = runIds[0] ?? '';
  const runDir = path.join(BENCH_DIR, 'runs', runId);
  const sheetFile = files(runId).sheet;
  const keyFile = files(runId).key;

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
