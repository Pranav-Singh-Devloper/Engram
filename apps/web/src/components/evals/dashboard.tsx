'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { BenchRun } from '@/lib/api';
import { pct } from '@/lib/format';
import { CATEGORY_LABEL, MODE_STYLE, SPLIT_LABEL, orderedModes } from '@/lib/modes';
import { cn } from '@/lib/utils';
import { GroupedBars } from './grouped-bars';

const FEATURED = ['2026-10-18-test', '2026-10-19-longmemeval'];

function Legend({ modes }: { modes: string[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {modes.map((m) => (
        <li key={m} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: MODE_STYLE[m]?.color }} />
          {MODE_STYLE[m]?.label ?? m}
        </li>
      ))}
    </ul>
  );
}

function ModeTable({ run }: { run: BenchRun }) {
  const modes = orderedModes(Object.keys(run.modes));
  const anyCost = modes.some((m) => run.modes[m]?.requestsPerItem !== undefined);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="font-mono text-[11px] text-muted-foreground">
          <tr className="border-b">
            <th className="py-2 pr-3 text-left font-normal">mode</th>
            <th className="py-2 pr-3 text-right font-normal">accuracy</th>
            <th className="py-2 pr-3 text-right font-normal">recall@8</th>
            {anyCost && <th className="py-2 pr-3 text-right font-normal">requests / item</th>}
            {anyCost && <th className="py-2 text-right font-normal">prompt tokens / item</th>}
          </tr>
        </thead>
        <tbody>
          {modes.map((m) => {
            const r = run.modes[m];
            if (!r) return null;
            return (
              <tr key={m} className="border-b last:border-0">
                <td className="py-2 pr-3">
                  <span
                    className="mr-2 inline-block size-2 rounded-sm"
                    style={{ background: MODE_STYLE[m]?.color }}
                  />
                  {MODE_STYLE[m]?.label ?? m}
                </td>
                <td className="py-2 pr-3 text-right font-mono tabular-nums">{pct(r.accuracy)}</td>
                <td className="py-2 pr-3 text-right font-mono tabular-nums text-muted-foreground">
                  {r.recallAt8 === null ? '—' : pct(r.recallAt8)}
                </td>
                {anyCost && (
                  <td className="py-2 pr-3 text-right font-mono tabular-nums text-muted-foreground">
                    {r.requestsPerItem?.toFixed(1) ?? '—'}
                  </td>
                )}
                {anyCost && (
                  <td className="py-2 text-right font-mono tabular-nums text-muted-foreground">
                    {r.promptTokensPerItem?.toLocaleString('en') ?? '—'}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Dashboard() {
  const q = useQuery({ queryKey: ['evals'], queryFn: api.evals });
  const runs = useMemo(() => (q.data?.runs ?? []).filter((r) => !r.retrievalOnly), [q.data]);
  const [picked, setPicked] = useState<string | null>(null);
  const featured = FEATURED.flatMap((id) => runs.filter((r) => r.runId === id));
  const run = runs.find((r) => r.runId === (picked ?? featured[0]?.runId)) ?? runs[0];

  if (q.isPending)
    return <p className="p-8 text-sm text-muted-foreground">Loading bench results…</p>;
  if (q.isError || !run)
    return <p className="p-8 text-sm text-muted-foreground">No bench results found.</p>;

  const modes = orderedModes(Object.keys(run.modes));
  const groups = Object.entries(run.categories ?? {}).map(([c, byMode]) => ({
    key: c,
    label: CATEGORY_LABEL[c] ?? c,
    values: Object.fromEntries(modes.map((m) => [m, byMode[m]?.accuracy ?? null])),
    n: Object.values(byMode)[0]?.n,
  }));
  const a = q.data.agreement;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Evals</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        Engram against three baselines on the same composer: the last 20 turns (buffer), the top 8
        turns by similarity (rag), and the whole history (full context). Every number comes from a
        committed report in <code className="font-mono text-xs">bench/reports/</code>; nothing was
        tuned on the test split or LongMemEval.
      </p>

      <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Bench run">
        {(featured.length ? featured : runs.slice(0, 2)).map((r) => (
          <button
            key={r.runId}
            role="tab"
            aria-selected={r.runId === run.runId}
            onClick={() => {
              setPicked(r.runId);
            }}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-sm transition-colors',
              r.runId === run.runId
                ? 'border-accent bg-accent/10 text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {SPLIT_LABEL[r.split] ?? r.split} · {r.items} items
          </button>
        ))}
      </div>

      <section className="mt-4 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">
            {SPLIT_LABEL[run.split] ?? run.split}{' '}
            <span className="font-mono text-xs text-muted-foreground">{run.runId}</span>
          </h2>
          <p className="font-mono text-[11px] text-muted-foreground">
            {run.model} · judge {run.judge}
          </p>
        </div>
        <div className="mt-3">
          <Legend modes={modes} />
        </div>
        {groups.length > 0 ? (
          <div className="mt-2">
            <GroupedBars groups={groups} modes={modes} />
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            This run's summary has no per-category breakdown.
          </p>
        )}
        <div className="mt-4">
          <ModeTable run={run} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Requests and tokens per item include ingest. Engram pays at ingest (extraction,
          embeddings, resolution) once; a question then costs one query embedding and one compose
          call over at most 8 memories. Full context pays on every question, and its prompt grows
          with the history.
        </p>
        {run.split === 'test' && (
          <p className="mt-3 text-xs text-muted-foreground">
            The test split saturates: its ~48-turn histories fit in one prompt, so it separates
            buffer from the rest, not Engram from rag or full context. LongMemEval (~470-turn
            histories) is the discriminating benchmark.
          </p>
        )}
        {run.split === 'longmemeval' && (
          <p className="mt-3 text-xs text-muted-foreground">
            Run with local embeddings (embeddinggemma) and packed extraction to fit free quotas
            (ADR-018); both cost Engram points on dev-long. Judged by our Groq judge, not the
            paper’s GPT-4o. Engram distills ~25 facts per 470-turn history, and these detail
            questions favor raw-turn retrieval.
          </p>
        )}
      </section>

      {a && (
        <section className="mt-4 rounded-lg border bg-card p-4">
          <h2 className="font-medium">Is the judge right?</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {a.pooled.n} judged answers, labelled blind by hand ({a.pooled.humanCorrect} correct,{' '}
            {a.pooled.humanIncorrect} incorrect).
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['agreement', pct(a.pooled.agreement)],
              ["Cohen's κ", a.pooled.kappa === null ? 'undefined' : a.pooled.kappa.toFixed(2)],
              ['too lenient', String(a.pooled.judgeTooLenient)],
              ['too strict', String(a.pooled.judgeTooStrict)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-muted/50 p-3">
                <dt className="font-mono text-[11px] text-muted-foreground">{k}</dt>
                <dd className="mt-0.5 text-xl font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="mt-4 rounded-lg border bg-card p-4">
        <h2 className="font-medium">Run history</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="font-mono text-[11px] text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3 text-left font-normal">run</th>
                <th className="py-2 pr-3 text-left font-normal">split</th>
                <th className="py-2 pr-3 text-left font-normal">model</th>
                <th className="py-2 text-right font-normal">best accuracy</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const best = Object.entries(r.modes).sort(
                  ([, x], [, y]) => y.accuracy - x.accuracy,
                )[0];
                return (
                  <tr
                    key={r.runId}
                    onClick={() => {
                      setPicked(r.runId);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className={cn(
                      'cursor-pointer border-b last:border-0 hover:bg-muted/40',
                      r.runId === run.runId && 'bg-accent/5',
                    )}
                  >
                    <td className="py-2 pr-3 font-mono text-xs">{r.runId}</td>
                    <td className="py-2 pr-3">{SPLIT_LABEL[r.split] ?? r.split}</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">{r.model}</td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      {best
                        ? `${pct(best[1].accuracy)} ${MODE_STYLE[best[0]]?.label ?? best[0]}`
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
