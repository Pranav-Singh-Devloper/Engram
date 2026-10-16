// Turns a run's per-item results into a markdown report (SPEC §13.5).
import { CATEGORIES } from '../dataset/schema.js';
import { isAbstention } from './judge.js';
import { MODES } from './modes.js';
import type { Mode } from './modes.js';
import type { ItemResult } from './run.js';

const pct = (num: number, den: number) => (den === 0 ? '—' : `${Math.round((100 * num) / den)}%`);

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
}

export interface ReportMeta {
  runId: string;
  split: string;
  model: string;
  judge: string;
  date: string;
}

export function renderReport(results: readonly ItemResult[], meta: ReportMeta): string {
  const modes = MODES.filter((m) => results.some((r) => r.mode === m));
  const of = (mode: Mode, category?: string) =>
    results.filter((r) => r.mode === mode && (category === undefined || r.category === category));
  const acc = (rs: ItemResult[]) => pct(rs.filter((r) => r.verdict.correct).length, rs.length);

  const lines: string[] = [];
  lines.push(`# Engram-Bench — ${meta.split} split, run ${meta.runId}`, '');
  lines.push(
    `${meta.date} · system model \`${meta.model}\` · judge \`${meta.judge}\` · ${new Set(results.map((r) => r.itemId)).size} items`,
    '',
  );

  lines.push('## Accuracy by category', '');
  lines.push(
    `| category | n | ${modes.join(' | ')} |`,
    `|---|---|${modes.map(() => '---').join('|')}|`,
  );
  for (const c of CATEGORIES) {
    const n = new Set(results.filter((r) => r.category === c).map((r) => r.itemId)).size;
    if (n === 0) continue;
    lines.push(`| ${c} | ${n} | ${modes.map((m) => acc(of(m, c))).join(' | ')} |`);
  }
  lines.push(
    `| **all** | ${new Set(results.map((r) => r.itemId)).size} | ${modes.map((m) => `**${acc(of(m))}**`).join(' | ')} |`,
    '',
  );

  lines.push('## Abstention and cost', '');
  lines.push(
    '| mode | abstention precision | abstention recall | real calls / item | cached / item | prompt tokens / item | latency p50 | latency p95 |',
    '|---|---|---|---|---|---|---|---|',
  );
  for (const m of modes) {
    const rs = of(m);
    const abstained = rs.filter((r) => isAbstention(r.answer));
    const unanswerable = rs.filter((r) => r.category === 'abstention');
    const truePos = abstained.filter((r) => r.category === 'abstention').length;
    const avg = (f: (r: ItemResult) => number) =>
      rs.length === 0 ? 0 : rs.reduce((n, r) => n + f(r), 0) / rs.length;
    lines.push(
      `| ${m} | ${pct(truePos, abstained.length)} | ${pct(truePos, unanswerable.length)} | ${avg((r) => r.usage.calls).toFixed(1)} | ${avg((r) => r.usage.cached).toFixed(1)} | ${Math.round(avg((r) => r.usage.promptTokens))} | ${quantile(
        rs.map((r) => r.latencyMs),
        0.5,
      )} ms | ${quantile(
        rs.map((r) => r.latencyMs),
        0.95,
      )} ms |`,
    );
  }
  lines.push(
    '',
    'Latency includes cache hits, so it understates cold runs. Real calls and tokens count only what this run sent to the network.',
    '',
  );

  const engram = of('engram').filter((r) => r.answer.store);
  if (engram.length > 0) {
    const sum = (f: (r: ItemResult) => number) => engram.reduce((n, r) => n + f(r), 0);
    lines.push('## Engram store health', '');
    lines.push(
      `- Ad-hoc predicate rate: ${pct(
        sum((r) => r.answer.store?.adHoc ?? 0),
        sum((r) => r.answer.store?.facts ?? 0),
      )} of current facts (SPEC §18 threshold ~15%).`,
    );
    lines.push(
      `- Duplicate-entity rate: ${pct(
        sum((r) => r.answer.store?.duplicateEntities ?? 0),
        sum((r) => r.answer.store?.entities ?? 0),
      )} of entities share a name with another.`,
    );
    lines.push('- Retrieval recall@8: not measured until P05 adds relevance labels.', '');
  }

  lines.push('## Misses', '');
  for (const r of results
    .filter((x) => !x.verdict.correct)
    .sort((a, b) => a.itemId.localeCompare(b.itemId) || a.mode.localeCompare(b.mode))) {
    lines.push(
      `- \`${r.itemId}\` ${r.mode} (${r.category}): ${r.question} — expected *${r.expected}*, got "${r.answer.answer}" (${r.verdict.reason})`,
    );
  }
  return `${lines.join('\n')}\n`;
}
