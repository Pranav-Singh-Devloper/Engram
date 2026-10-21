// The quota simulator is the provider's own rotation: the real GeminiProvider,
// given fake keys with the same quotas, serves each call from the same key.
import { EMBEDDING_DIM, GeminiProvider } from '@engram/core';
import { describe, expect, it } from 'vitest';
import {
  ABLATION,
  LONGMEMEVAL_UNIQUE_TURNS,
  QUOTA,
  simulateKeys,
  transportTable,
  workload,
} from './providers';
import type { Call } from './providers';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
// Gemini's daily-quota reply: a 429 whose retry delay is far beyond backoff.
const daily = () =>
  json(
    {
      error: {
        code: 429,
        details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '40000s' }],
      },
    },
    429,
  );
const composed = () =>
  json({
    candidates: [
      {
        content: {
          parts: [{ text: JSON.stringify({ answer: 'x', supported: false, usedMemoryIds: [] }) }],
        },
      },
    ],
  });

/** Runs a workload through GeminiProvider over fake keys with these quotas; returns who served what. */
async function realProvider(calls: readonly Call[], keys: number, quota: typeof QUOTA) {
  const names = Array.from({ length: keys }, (_, i) => `key${String(i)}`);
  const used = names.map(() => ({ generate: 0, embed: 0 }));
  // Which key served the call in flight; set by the fake when a key accepts it.
  const last: { servedBy: number | null } = { servedBy: null };
  const fetch = (url: string, init: { headers: Record<string, string>; body: string }) => {
    const k = names.indexOf(init.headers['x-goog-api-key'] ?? '');
    const u = used[k];
    if (!u) return Promise.resolve(daily());
    if (url.endsWith(':batchEmbedContents')) {
      const { requests } = JSON.parse(init.body) as { requests: unknown[] };
      if (u.embed + requests.length > quota.embedTexts) return Promise.resolve(daily());
      u.embed += requests.length;
      last.servedBy = k;
      return Promise.resolve(
        json({
          embeddings: requests.map(() => ({
            values: Array.from({ length: EMBEDDING_DIM }, (_, j) => (j === 0 ? 1 : 0)),
          })),
        }),
      );
    }
    if (u.generate + 1 > quota.generate) return Promise.resolve(daily());
    u.generate++;
    last.servedBy = k;
    return Promise.resolve(composed());
  };
  const provider = new GeminiProvider({
    apiKey: names[0] ?? '',
    fallbackApiKeys: names.slice(1),
    chatModel: 'gemini-test',
    http: {
      fetch: fetch as unknown as typeof globalThis.fetch,
      sleep: () => Promise.resolve(),
      random: () => 0.5,
    },
  });
  const out: (number | null)[] = [];
  for (const c of calls) {
    last.servedBy = null;
    try {
      if (c.lane === 'generate')
        await provider.compose({ question: 'q', now: new Date(), memories: [] });
      else
        await provider.embed(
          Array.from({ length: c.texts }, (_, i) => `t${String(i)}`),
          { purpose: 'document' },
        );
      out.push(last.servedBy);
    } catch {
      out.push(null);
    }
  }
  return out;
}

describe('providers chapter data', () => {
  it('rotates keys per lane exactly as GeminiProvider does', async () => {
    const quota = { generate: 6, embedTexts: 40 };
    for (const [generate, texts, keys] of [
      [10, 60, 3],
      [20, 30, 2],
      [3, 150, 4],
      [30, 200, 3],
    ] as const) {
      for (const order of ['mixed', 'generate-first'] as const) {
        const calls = workload(generate, texts, 7, order);
        const sim = simulateKeys(calls, keys, 'lane', quota);
        expect(
          await realProvider(calls, keys, quota),
          `${String(generate)}/${String(texts)} ${order}`,
        ).toEqual(sim.servedBy);
      }
    }
  });

  it('shows why a shared key index wasted quota (the 2026-10-19 incident)', () => {
    const served = (r: ReturnType<typeof simulateKeys>) =>
      r.servedBy.filter((k) => k !== null).length;
    // Extraction first, then embedding: a shared index leaves keys 0–2 with
    // unused embedding quota and runs out; per-lane rotation serves it all.
    const first = workload(2000, 2500, 20, 'generate-first');
    expect(served(simulateKeys(first, 5, 'lane'))).toBe(first.length);
    expect(served(simulateKeys(first, 5, 'shared'))).toBeLessThan(first.length);
    // Evenly mixed, both need the same keys: the bug only shows when lanes drift apart.
    const mixed = workload(1500, 3000);
    expect(served(simulateKeys(mixed, 5, 'shared'))).toBe(mixed.length);
  });

  it('builds workloads with exactly the calls and texts asked for', () => {
    const w = workload(37, 450, 20);
    expect(w.filter((c) => c.lane === 'generate')).toHaveLength(37);
    expect(w.reduce((s, c) => s + (c.lane === 'embed' ? c.texts : 0), 0)).toBe(450);
  });

  it('reads the ablation and ADR-016 tables from the repo', () => {
    expect(ABLATION.map((r) => r.row)).toEqual(['A', 'B', 'C', 'C′']);
    expect(ABLATION.map((r) => Math.round(r.accuracy * 100))).toEqual([100, 93, 88, 95]);
    const t = transportTable();
    expect(t).toHaveLength(4);
    expect(t[0]?.wallSeconds).toBe(550);
    expect(Math.round(LONGMEMEVAL_UNIQUE_TURNS / (QUOTA.embedTexts * 4))).toBe(11);
  });
});
