// Calibrates the engine's similarity thresholds for an embedder from the
// labelled dev pair set (P08b decision 6, ADR-017):
//   pnpm bench:calibrate --embedder=gemini|local [--max-false=0.01]
// For each family it reports today's threshold's error rates and the lowest
// threshold whose false-merge rate (negatives at or above it) is within
// --max-false, with the share of positives that threshold keeps. Writes
// bench/calibration/<space>.json. It suggests; ADR-017 decides.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { OllamaEmbedder, config, cosine } from '@engram/core';
import { loadEnv, makeProviders } from '../runner/providers.js';
import { FAMILIES, buildPairs } from './pairs.js';
import type { Family, Pair } from './pairs.js';

const arg = (name: string, fallback: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

/** Today's thresholds (tuned on Gemini embeddings), by family. */
export const CURRENT: Record<Family, number> = {
  entityMatch: config.entities.matchThreshold,
  descriptionConflict: config.entities.descriptionConflictThreshold,
  merge: config.conflict.mergeThreshold,
  entitySearch: config.entities.searchMinSimilarity,
  drift: config.consolidation.driftThreshold,
};

export interface FamilyReport {
  positives: number;
  negatives: number;
  /** At today's threshold: negatives scoring ≥ t, positives scoring < t. */
  current: { threshold: number; falsePositive: number; falseNegative: number };
  /** The lowest t with falsePositive ≤ maxFalse, and the positives it keeps. */
  suggested: { threshold: number; falsePositive: number; positivesKept: number };
  /** Ranges, to see the margin between the classes. */
  positiveRange: [number, number];
  negativeRange: [number, number];
  /** Positives' 5th/10th/50th and negatives' 50th/90th/95th percentiles. */
  percentiles: { positive: [number, number, number]; negative: [number, number, number] };
}

/** The q-quantile of sorted values (nearest rank). */
const pct = (sorted: number[], q: number) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] ?? 0;

/** Pure: given scored pairs, the report for one family. Exported for tests. */
export function reportFamily(
  scored: { positive: boolean; score: number }[],
  current: number,
  maxFalse: number,
): FamilyReport {
  const pos = scored
    .filter((s) => s.positive)
    .map((s) => s.score)
    .sort((a, b) => a - b);
  const neg = scored
    .filter((s) => !s.positive)
    .map((s) => s.score)
    .sort((a, b) => a - b);
  const rate = (xs: number[], f: (x: number) => boolean) =>
    xs.length === 0 ? 0 : xs.filter(f).length / xs.length;
  // Candidate thresholds: just above each negative (and 0), lowest first.
  const candidates = [0, ...neg.map((x) => x + 1e-6)].sort((a, b) => a - b);
  const t = candidates.find((c) => rate(neg, (x) => x >= c) <= maxFalse) ?? 1;
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return {
    positives: pos.length,
    negatives: neg.length,
    current: {
      threshold: current,
      falsePositive: round(rate(neg, (x) => x >= current)),
      falseNegative: round(rate(pos, (x) => x < current)),
    },
    suggested: {
      threshold: round(Math.ceil(t * 1000) / 1000),
      falsePositive: round(rate(neg, (x) => x >= t)),
      positivesKept: round(rate(pos, (x) => x >= t)),
    },
    positiveRange: [round(pos[0] ?? 0), round(pos.at(-1) ?? 0)],
    negativeRange: [round(neg[0] ?? 0), round(neg.at(-1) ?? 0)],
    percentiles: {
      positive: [round(pct(pos, 0.05)), round(pct(pos, 0.1)), round(pct(pos, 0.5))],
      negative: [round(pct(neg, 0.5)), round(pct(neg, 0.9)), round(pct(neg, 0.95))],
    },
  };
}

async function main(): Promise<void> {
  loadEnv();
  const which = arg('embedder', 'gemini');
  const maxFalse = Number(arg('max-false', '0.01'));
  const { gemini } = makeProviders();
  const embedder =
    which === 'local'
      ? new OllamaEmbedder({ model: process.env.OLLAMA_EMBED_MODEL || undefined })
      : gemini;
  const space = await embedder.embeddingSpace();
  const pairs = buildPairs();

  // Embed each distinct text once per purpose, as the engine would.
  const docTexts = [...new Set(pairs.flatMap((p) => (p.query ? [p.b] : [p.a, p.b])))];
  const queryTexts = [...new Set(pairs.filter((p) => p.query).map((p) => p.a))];
  const doc = new Map(docTexts.map((t, i) => [t, i]));
  const docVecs = await embedder.embed(docTexts, { purpose: 'document' });
  const qVecs = queryTexts.length > 0 ? await embedder.embed(queryTexts, { purpose: 'query' }) : [];
  const q = new Map(queryTexts.map((t, i) => [t, i]));
  const vec = (text: string, query: boolean) =>
    (query ? qVecs[q.get(text) ?? -1] : docVecs[doc.get(text) ?? -1]) ?? [];
  const score = (p: Pair) => cosine(vec(p.a, p.query ?? false), vec(p.b, false));

  const report: Record<string, FamilyReport> = {};
  for (const family of Object.keys(FAMILIES) as Family[]) {
    const scored = pairs
      .filter((p) => p.family === family)
      .map((p) => ({ positive: p.positive, score: score(p) }));
    report[family] = reportFamily(scored, CURRENT[family], maxFalse);
  }
  const out = {
    space,
    generatedAt: new Date().toISOString(),
    maxFalse,
    pairs: pairs.length,
    families: report,
  };
  const file = path.resolve(import.meta.dirname, `${space.replace(/[^\w.-]+/g, '_')}.json`);
  writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`${space}: ${pairs.length} pairs (max false-merge ${maxFalse})`);
  console.log(
    'family               current (fp / fn)        suggested (fp / kept)    positives       negatives',
  );
  for (const [f, r] of Object.entries(report)) {
    console.log(
      `${f.padEnd(20)} ${r.current.threshold.toFixed(3)} (${r.current.falsePositive} / ${r.current.falseNegative})`.padEnd(
        45,
      ) +
        `${r.suggested.threshold.toFixed(3)} (${r.suggested.falsePositive} / ${r.suggested.positivesKept})`.padEnd(
          25,
        ) +
        `${r.positiveRange.join('–').padEnd(16)}${r.negativeRange.join('–').padEnd(14)}` +
        `pos p5/p10/p50 ${r.percentiles.positive.join('/')}  neg p50/p90/p95 ${r.percentiles.negative.join('/')}`,
    );
  }
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
