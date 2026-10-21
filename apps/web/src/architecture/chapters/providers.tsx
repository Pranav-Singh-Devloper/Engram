'use client';

import { motion, useReducedMotion } from 'motion/react';
import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  ABLATION,
  LOCAL_TEXTS_PER_SECOND,
  LONGMEMEVAL_UNIQUE_TURNS,
  QUOTA,
  simulateKeys,
  transportTable,
  workload,
} from '../data/providers';
import type { Lane } from '../data/providers';

const pct = (x: number) => `${String(Math.round(x * 100))}%`;

const METHODS = [
  ['processEpisode', 'extract facts, entities and time hints from a turn'],
  ['extractSessions', 'the same, for whole sessions in one call (ADR-015)'],
  ['disambiguate', 'is this “Sam” one of the Sams we know?'],
  ['adjudicate', 'a conflict the rules can’t decide'],
  ['summarize', 'consolidation: a cluster of turns → facts + summary'],
  ['compose', 'answer from recalled memories, citing the ones used'],
  ['judge', 'the bench’s answer grader'],
] as const;

function Ablation() {
  const still = useReducedMotion();
  const deltas = ABLATION.slice(1).map((r, i) => r.accuracy - (ABLATION[i]?.accuracy ?? 0));
  const why = [
    'generation: qwen3.5:9b for Gemini',
    'embeddings: embeddinggemma for Gemini',
    'one shared extraction rule',
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-4">
      {ABLATION.map((r, i) => {
        const ku = r.categories.knowledge_update;
        return (
          <div key={r.row} className="rounded-lg border bg-card p-3">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-lg font-semibold">{r.row}</span>
              {i > 0 && (
                <span
                  className={cn(
                    'font-mono text-xs',
                    (deltas[i - 1] ?? 0) < 0 ? 'text-danger' : 'text-success',
                  )}
                >
                  {(deltas[i - 1] ?? 0) > 0 ? '+' : ''}
                  {Math.round((deltas[i - 1] ?? 0) * 100)} pts
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {r.generation}
              <br />+ {r.embeddings}
            </p>
            <div className="mt-3 flex h-28 items-end gap-2">
              {[
                { label: 'accuracy', v: r.accuracy, color: 'var(--accent)' },
                { label: 'recall@8', v: r.recallAt8 ?? 0, color: 'var(--valid)' },
                { label: 'updates', v: ku?.accuracy ?? 0, color: 'var(--record)' },
              ].map((b) => (
                <div key={b.label} className="flex h-full flex-1 flex-col items-center justify-end">
                  <span className="font-mono text-[10px] tabular-nums">{pct(b.v)}</span>
                  <motion.span
                    className="mt-1 w-full origin-bottom rounded-t-sm"
                    style={{ background: b.color, height: '100%' }}
                    initial={{ scaleY: 0 }}
                    whileInView={{ scaleY: b.v }}
                    viewport={{ once: true }}
                    transition={still ? { duration: 0 } : { duration: 0.7, delay: i * 0.12 }}
                  />
                  <span className="mt-1 text-[9px] text-muted-foreground">{b.label}</span>
                </div>
              ))}
            </div>
            {i > 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">changed: {why[i - 1]}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Transport() {
  const rows = transportTable();
  const max = Math.max(...rows.map((r) => r.wallSeconds));
  return (
    <ul className="space-y-2">
      {rows.map((r, i) => (
        <li key={r.run} className="text-xs">
          <span className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-2">
            <span className={cn(i === 0 && 'font-medium')}>
              {r.run}
              {i === 0 && <span className="ml-1.5 text-accent">· default</span>}
            </span>
            <span className="shrink-0 font-mono text-muted-foreground">
              {r.repairs} repaired · {r.failures} failed · {r.goldRecall} facts
            </span>
          </span>
          <span className="mt-1 flex items-center gap-2">
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-valid"
                style={{ width: `${String((r.wallSeconds / max) * 100)}%` }}
              />
            </span>
            <span className="w-12 text-right font-mono tabular-nums">{r.wallSeconds} s</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

const PRESETS = [
  {
    label: 'the 2026-10-19 incident',
    generate: 2000,
    texts: 2500,
    order: 'generate-first' as const,
    keys: 5,
  },
  { label: 'demo at its daily cap', generate: 360, texts: 600, order: 'mixed' as const, keys: 1 },
  { label: 'a busy mixed day', generate: 1500, texts: 3000, order: 'mixed' as const, keys: 3 },
];

function QuotaSim() {
  const [keys, setKeys] = useState(5);
  const [generate, setGenerate] = useState(2000);
  const [texts, setTexts] = useState(2500);
  const [order, setOrder] = useState<'mixed' | 'generate-first'>('generate-first');
  const calls = useMemo(() => workload(generate, texts, 20, order), [generate, texts, order]);
  const runs = useMemo(
    () => ({
      lane: simulateKeys(calls, keys, 'lane'),
      shared: simulateKeys(calls, keys, 'shared'),
    }),
    [calls, keys],
  );
  const lanes: Lane[] = ['generate', 'embed'];
  const limit = { generate: QUOTA.generate, embed: QUOTA.embedTexts };
  const failed = (r: (typeof runs)['lane'], lane: Lane) =>
    calls.reduce(
      (s, c, i) =>
        s + (c.lane === lane && r.servedBy[i] === null ? (c.lane === 'embed' ? c.texts : 1) : 0),
      0,
    );
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => {
              setKeys(p.keys);
              setGenerate(p.generate);
              setTexts(p.texts);
              setOrder(p.order);
            }}
            className="rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="mt-3 grid gap-3 text-xs sm:grid-cols-4">
        {[
          { label: 'keys', v: keys, set: setKeys, min: 1, max: 5, step: 1 },
          { label: 'generate calls', v: generate, set: setGenerate, min: 0, max: 2500, step: 50 },
          { label: 'texts embedded', v: texts, set: setTexts, min: 0, max: 5000, step: 100 },
        ].map((c) => (
          <label key={c.label} className="block">
            <span className="flex justify-between text-muted-foreground">
              {c.label}{' '}
              <span className="font-mono text-foreground">{c.v.toLocaleString('en')}</span>
            </span>
            <input
              type="range"
              min={c.min}
              max={c.max}
              step={c.step}
              value={c.v}
              onChange={(e) => {
                c.set(Number(e.target.value));
              }}
              className="mt-1 w-full accent-[var(--accent)]"
              aria-label={c.label}
            />
          </label>
        ))}
        <div className="flex items-end gap-1">
          {(['mixed', 'generate-first'] as const).map((o) => (
            <button
              key={o}
              onClick={() => {
                setOrder(o);
              }}
              className={cn(
                'flex-1 rounded-md border px-2 py-1 font-mono text-[10px]',
                order === o ? 'border-accent bg-accent/10' : 'text-muted-foreground',
              )}
            >
              {o === 'mixed' ? 'interleaved' : 'generation first'}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {(['shared', 'lane'] as const).map((mode) => {
          const r = runs[mode];
          return (
            <div key={mode} className="rounded-lg border p-3">
              <p className="text-sm font-medium">
                {mode === 'lane'
                  ? 'Per-lane rotation (now)'
                  : 'One shared key index (before 2c762bf)'}
              </p>
              <div className="mt-2 space-y-2">
                {lanes.map((lane) => (
                  <div key={lane}>
                    <p className="font-mono text-[10px] text-muted-foreground">
                      {lane === 'generate' ? 'generate calls' : 'embedded texts'} · {limit[lane]} a
                      key
                    </p>
                    <div
                      className="mt-1 grid gap-1"
                      style={{ gridTemplateColumns: `repeat(${String(keys)}, 1fr)` }}
                    >
                      {r.used[lane].map((u, k) => (
                        <div
                          key={k}
                          className="h-5 overflow-hidden rounded-sm bg-muted"
                          title={`key ${String(k)}: ${String(u)}`}
                        >
                          <div
                            className="h-full origin-left transition-transform duration-500"
                            style={{
                              transform: `scaleX(${String(u / limit[lane])})`,
                              background: lane === 'generate' ? 'var(--record)' : 'var(--valid)',
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p
                className={cn(
                  'mt-2 font-mono text-[11px]',
                  failed(r, 'generate') + failed(r, 'embed') > 0 ? 'text-danger' : 'text-success',
                )}
              >
                {failed(r, 'generate') + failed(r, 'embed') === 0
                  ? 'everything served'
                  : `failed: ${String(failed(r, 'generate'))} generate calls, ${failed(r, 'embed').toLocaleString('en')} texts`}
              </p>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Each bar is one key’s daily quota, filled by the same simulated day. With one index, a key
        whose generate calls ran out also stopped embedding, though it had embedding quota left. On
        2026-10-19 that walked a five-key rotation to its last key early; four of the five keys
        still accepted embeddings minutes later. The simulator is tested against the real provider:
        driven through the same workload, GeminiProvider serves every call from the same key.
      </p>
    </div>
  );
}

export function Providers() {
  const [keys, setKeys] = useState(4);
  const days = LONGMEMEVAL_UNIQUE_TURNS / (QUOTA.embedTexts * keys);
  return (
    <div>
      <p className="max-w-3xl text-muted-foreground">
        Every model call goes through one interface: seven structured methods and{' '}
        <code className="font-mono text-sm">embed</code>. Every reply is validated against a zod
        contract and repaired once if it doesn’t parse, whichever model sent it. Five
        implementations sit behind it: Gemini (the hosted demo and the bench), Ollama (local mode,
        nothing leaves the machine), any OpenAI-compatible server (llama.cpp, LM Studio, vLLM), Groq
        (the bench’s judge, so the system under test never grades itself), and the FakeProvider
        every unit test runs on, so no test touches the network.
        <code className="font-mono text-sm">withEmbedder</code> pairs one provider’s generation with
        another’s embeddings.
      </p>

      <ul className="mt-5 grid gap-1.5 text-xs sm:grid-cols-2 lg:grid-cols-4">
        {METHODS.map(([m, d]) => (
          <li key={m} className="rounded-md border bg-card px-2.5 py-1.5">
            <code className="font-mono text-accent">{m}</code>
            <span className="block text-muted-foreground">{d}</span>
          </li>
        ))}
        <li className="rounded-md border bg-card px-2.5 py-1.5">
          <code className="font-mono text-valid">embed</code>
          <span className="block text-muted-foreground">768-d vectors, document or query</span>
        </li>
      </ul>

      <h3 className="mt-10 text-lg font-semibold">Going local, measured one swap at a time</h3>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        dev-long, 40 items, the same judge. Swapping one model per row splits the gap between Gemini
        and a fully local Engram into its causes. Retrieval stays at 97% recall@8 in every row. Most
        of the loss is knowledge updates: qwen re-extracted a city mentioned only as a time
        reference as current. One rule added to the shared extraction prompt (C′) fixed three of
        those four, and Gemini’s row A was rerun with it before it merged: still 100%.
      </p>
      <div className="mt-4">
        <Ablation />
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border p-4">
          <h3 className="font-medium">The transport spike (ADR-016)</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Ollama can’t constrain qwen3.5’s output to a schema (every route returns 501), so the
            schema goes in the prompt. Grammar-constrained llama.cpp was measured against it on the
            30 structured calls of the golden fixtures. The rule, set before running, was to adopt
            the grammar only if it removed off-schema replies at comparable speed.
          </p>
          <div className="mt-3">
            <Transport />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            The grammar cut repairs to 1 but ran 46% slower with no more facts recovered, and one
            repair round already absorbs most bad replies, so Ollama stays the default. Lowering the
            presence penalty didn’t reduce repairs at all.
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <h3 className="font-medium">Quota arithmetic: texts, not requests (ADR-018)</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            The plan assumed a batch of up to 100 texts was one request against the 1,000-a-day
            embedding quota. A fresh key ran out after 277 requests carrying 1,019 texts: the quota
            counts texts, and batching saves nothing. LongMemEval-S has{' '}
            {LONGMEMEVAL_UNIQUE_TURNS.toLocaleString('en')} unique turns.
          </p>
          <label className="mt-3 block text-xs">
            <span className="flex justify-between text-muted-foreground">
              free keys <span className="font-mono text-foreground">{keys}</span>
            </span>
            <input
              type="range"
              min={1}
              max={5}
              value={keys}
              onChange={(e) => {
                setKeys(Number(e.target.value));
              }}
              className="mt-1 w-full accent-[var(--accent)]"
              aria-label="Free keys"
            />
          </label>
          <dl className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-muted/50 p-3">
              <dt className="font-mono text-[10px] text-muted-foreground">Gemini embeddings</dt>
              <dd className="text-xl font-semibold tabular-nums">{days.toFixed(1)} days</dd>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <dt className="font-mono text-[10px] text-muted-foreground">embeddinggemma, local</dt>
              <dd className="text-xl font-semibold tabular-nums">
                {Math.round(LONGMEMEVAL_UNIQUE_TURNS / LOCAL_TEXTS_PER_SECOND / 60)} minutes
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">
            So LongMemEval runs with Gemini generation and local embeddings, every embedding mode
            alike. On dev-long that swap cost about 5 points (row B → C), so its Engram number is
            probably a slight underestimate, and the report header names both models.
          </p>
        </div>
      </div>

      <h3 className="mt-10 text-lg font-semibold">Five keys, two quotas each</h3>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        Free quotas are per project and per model, so each key has a generate budget and an
        embedding budget, and they run out at different times. Keys rotate per lane.
      </p>
      <div className="mt-3">
        <QuotaSim />
      </div>
    </div>
  );
}
