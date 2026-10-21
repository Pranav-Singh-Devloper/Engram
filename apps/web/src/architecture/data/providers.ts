// The providers chapter (P09c chapter 11): the local-mode ablation and
// transport spike (bench explorer:data), and a simulator of Gemini's free
// quota across keys. The simulator mirrors GeminiProvider's rotation;
// providers.test.ts drives the real provider through the same workloads.
import adrs from '@/content/generated/adrs.json';
import bench from '@/content/generated/benchmarks.json';

export interface AblationRow {
  row: string;
  run: string;
  generation: string;
  embeddings: string;
  accuracy: number;
  recallAt8: number | null;
  categories: Record<string, { accuracy: number; n: number } | null>;
}

export const ABLATION = bench.ablation as AblationRow[];

/** ADR-016's transport table, read from DECISIONS.md, so the chart can't drift from the ADR. */
export function transportTable() {
  type Block = { type: string; header?: string[]; rows?: string[][] };
  const adr = (adrs as { id: string; sections: { blocks: Block[] }[] }[]).find(
    (a) => a.id === 'ADR-016',
  );
  const table = adr?.sections.flatMap((s) => s.blocks).find((b) => b.type === 'table');
  const num = (s: string) => Number(s.replace(/[^0-9.]/g, ''));
  return (table?.rows ?? []).map((r) => ({
    run: (r[0] ?? '').replace(/\*/g, ''),
    wallSeconds: num(r[1] ?? ''),
    repairs: num(r[2] ?? ''),
    failures: num(r[3] ?? ''),
    outputTokens: num(r[4] ?? ''),
    goldRecall: (r[5] ?? '').replace(/\*/g, ''),
  }));
}

export const TRANSPORT_SPIKES = bench.transport as {
  transport: string;
  wallSeconds: number;
  structuredCalls: number;
  repairs: number;
  failures: number;
  goldRecall: string;
}[];

/** Free-tier quotas per key and day, as measured (ADR-018): calls for generation, texts for embeddings. */
export const QUOTA = { generate: 500, embedTexts: 1000 };
/** LongMemEval-S, 98 items: unique turns to embed (ADR-018). */
export const LONGMEMEVAL_UNIQUE_TURNS = 45_404;
/** embeddinggemma via Ollama on an M3 Pro (ADR-018). */
export const LOCAL_TEXTS_PER_SECOND = 40;

export type Lane = 'generate' | 'embed';
export type Call = { lane: 'generate' } | { lane: 'embed'; texts: number };

export interface SimResult {
  /** The key that served each call, or null when every key was out. */
  servedBy: (number | null)[];
  switches: { call: number; lane: Lane; to: number }[];
  used: Record<Lane, number[]>;
}

/**
 * Replays a workload over `keys` free keys. Per lane (today's provider), each
 * lane moves to the next key when its quota runs out; shared (before
 * 2c762bf), one index served both lanes, so a key out of generate calls also
 * stopped embedding. When the last key is out, calls fail and the index stays.
 */
export function simulateKeys(
  calls: readonly Call[],
  keys: number,
  mode: 'lane' | 'shared' = 'lane',
  quota = QUOTA,
): SimResult {
  const used: Record<Lane, number[]> = {
    generate: Array.from({ length: keys }, () => 0),
    embed: Array.from({ length: keys }, () => 0),
  };
  const limit: Record<Lane, number> = { generate: quota.generate, embed: quota.embedTexts };
  const index = { generate: 0, embed: 0, shared: 0 };
  const servedBy: (number | null)[] = [];
  const switches: SimResult['switches'] = [];
  calls.forEach((c, i) => {
    const cost = c.lane === 'generate' ? 1 : c.texts;
    const slot = mode === 'lane' ? c.lane : 'shared';
    for (;;) {
      const k = index[slot];
      if ((used[c.lane][k] ?? 0) + cost <= limit[c.lane]) {
        used[c.lane][k] = (used[c.lane][k] ?? 0) + cost;
        servedBy.push(k);
        return;
      }
      if (k >= keys - 1) {
        servedBy.push(null);
        return;
      }
      index[slot] = k + 1;
      switches.push({ call: i, lane: c.lane, to: k + 1 });
    }
  });
  return { servedBy, switches, used };
}

/**
 * A day's workload: `generate` calls and `texts` embedded in batches, either
 * interleaved evenly or with every generate call first (extraction, then
 * embedding), which is the order that exposed the shared index.
 */
export function workload(
  generate: number,
  texts: number,
  batch = 20,
  order: 'mixed' | 'generate-first' = 'mixed',
): Call[] {
  const embeds: Call[] = [];
  for (let left = texts; left > 0; left -= batch)
    embeds.push({ lane: 'embed', texts: Math.min(batch, left) });
  const gens: Call[] = Array.from({ length: generate }, () => ({ lane: 'generate' as const }));
  if (order === 'generate-first') return [...gens, ...embeds];
  const total = generate + embeds.length;
  const calls: Call[] = [];
  let g = 0;
  let e = 0;
  for (let i = 0; i < total; i++) {
    // Whichever lane is furthest behind its share goes next.
    const gShare = generate === 0 ? Infinity : g / generate;
    const eShare = embeds.length === 0 ? Infinity : e / embeds.length;
    const next = gShare <= eShare && g < generate ? gens[g++] : embeds[e++];
    if (next) calls.push(next);
  }
  return calls;
}
