// P08b decision 7: recall's model cost is one query embedding. Measure it while
// local extraction runs (both share the GPU) vs idle.
//   tsx spikes/recall-latency.ts <label> [samples]
import { OllamaEmbedder } from '@engram/core';

const label = process.argv[2] ?? 'idle';
const n = Number(process.argv[3] ?? 20);
const e = new OllamaEmbedder();
const ms: number[] = [];
for (let i = 0; i < n; i++) {
  const t = performance.now();
  await e.embed([`where does the user live ${i}`], { purpose: 'query' });
  ms.push(performance.now() - t);
  await new Promise((r) => setTimeout(r, 3000));
}
ms.sort((a, b) => a - b);
const q = (p: number) => Math.round(ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] ?? 0);
console.log(
  JSON.stringify({ label, samples: n, p50: q(0.5), p95: q(0.95), max: Math.round(ms.at(-1) ?? 0) }),
);
