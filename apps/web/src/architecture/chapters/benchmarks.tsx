'use client';

import 'katex/dist/katex.min.css';
import { scaleLinear, scaleLog } from 'd3';
import katex from 'katex';
import { useMemo, useState } from 'react';
import { GroupedBars } from '@/components/evals/grouped-bars';
import { CATEGORY_LABEL, MODE_STYLE, SPLIT_LABEL, orderedModes } from '@/lib/modes';
import { cn } from '@/lib/utils';
import { Cite } from '../cite';
import { AGREEMENT, RUNS, confusion, kappa } from '../data/benchmarks';
import { useWidth } from '../use-width';

const pct = (x: number) => `${String(Math.round(x * 100))}%`;
const KAPPA = String.raw`\kappa = \frac{p_o - p_e}{1 - p_e}`;

function Tex({ tex }: { tex: string }) {
  const html = useMemo(
    () => katex.renderToString(tex, { displayMode: true, throwOnError: false, output: 'html' }),
    [tex],
  );
  return <div className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />;
}

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

/** Accuracy against prompt tokens per item, for every mode of both runs (log x). */
function CostScatter() {
  const [box, W] = useWidth<HTMLDivElement>();
  const H = 280;
  const M = { l: 44, r: 16, t: 14, b: 36 };
  const points = RUNS.flatMap((run) =>
    Object.entries(run.modes)
      .filter(([, v]) => (v.promptTokensPerItem ?? 0) > 0)
      .map(([mode, v]) => ({ run, mode, tokens: v.promptTokensPerItem ?? 1, acc: v.accuracy })),
  );
  const x = scaleLog()
    .domain([300, 200_000])
    .range([M.l, W - M.r]);
  const y = scaleLinear()
    .domain([0, 1])
    .range([H - M.b, M.t]);
  return (
    <div ref={box}>
      <svg width={W} height={H} role="img" aria-label="Accuracy against prompt tokens per item">
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line
              x1={M.l}
              x2={W - M.r}
              y1={y(v)}
              y2={y(v)}
              stroke="var(--border)"
              strokeDasharray="2 4"
            />
            <text
              x={M.l - 6}
              y={y(v) + 3}
              textAnchor="end"
              className="fill-muted-foreground font-mono text-[10px]"
            >
              {pct(v)}
            </text>
          </g>
        ))}
        {[1_000, 10_000, 100_000].map((t) => (
          <text
            key={t}
            x={x(t)}
            y={H - 18}
            textAnchor="middle"
            className="fill-muted-foreground font-mono text-[10px]"
          >
            {t >= 1000 ? `${String(t / 1000)}k` : t}
          </text>
        ))}
        <text x={W - M.r} y={H - 4} textAnchor="end" className="fill-muted-foreground text-[10px]">
          prompt tokens per item, ingest included (log)
        </text>
        {points.map((p) => {
          const lme = p.run.split === 'longmemeval';
          const cx = x(p.tokens);
          const cy = y(p.acc);
          const color = MODE_STYLE[p.mode]?.color ?? 'var(--foreground)';
          return (
            <g key={`${p.run.runId}-${p.mode}`}>
              {lme ? (
                <rect
                  x={cx - 6}
                  y={cy - 6}
                  width={12}
                  height={12}
                  rx={2}
                  fill={color}
                  opacity={0.9}
                />
              ) : (
                <circle cx={cx} cy={cy} r={6.5} fill={color} opacity={0.9} />
              )}
              <title>{`${SPLIT_LABEL[p.run.split] ?? p.run.split} · ${MODE_STYLE[p.mode]?.label ?? p.mode}: ${pct(p.acc)} at ${p.tokens.toLocaleString('en')} tokens`}</title>
            </g>
          );
        })}
      </svg>
      <p className="text-[11px] text-muted-foreground">
        ● test split · ■ LongMemEval-S. Engram’s tokens are mostly ingest: extraction runs once per
        turn (packed into large calls on LongMemEval), and a question then costs one compose over at
        most 8 memories. full_context pays its whole history on every question.
      </p>
    </div>
  );
}

function Agreement() {
  const real = confusion(AGREEMENT.pooled);
  const [lenient, setLenient] = useState(real.judgeTooLenient);
  const [strict, setStrict] = useState(real.judgeTooStrict);
  const t = {
    bothCorrect: AGREEMENT.pooled.humanCorrect - strict,
    judgeTooStrict: strict,
    judgeTooLenient: lenient,
    bothIncorrect: AGREEMENT.pooled.humanIncorrect - lenient,
  };
  const n = AGREEMENT.pooled.n;
  const k = kappa(t);
  const agree = (t.bothCorrect + t.bothIncorrect) / n;
  const cell = (v: number, ok: boolean) => (
    <td
      className={cn(
        'h-14 w-1/2 text-center font-mono text-lg tabular-nums transition-colors',
        ok
          ? 'bg-success/10 text-success'
          : v > 0
            ? 'bg-danger/15 text-danger'
            : 'text-muted-foreground',
      )}
    >
      {v}
    </td>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <table className="w-full overflow-hidden rounded-lg border text-xs">
          <thead>
            <tr className="text-[10px] text-muted-foreground">
              <th className="p-1.5 font-normal" />
              <th className="p-1.5 font-normal">judge: correct</th>
              <th className="p-1.5 font-normal">judge: wrong</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t">
              <th className="p-1.5 text-left text-[10px] font-normal text-muted-foreground">
                human: correct ({AGREEMENT.pooled.humanCorrect})
              </th>
              {cell(t.bothCorrect, true)}
              {cell(t.judgeTooStrict, false)}
            </tr>
            <tr className="border-t">
              <th className="p-1.5 text-left text-[10px] font-normal text-muted-foreground">
                human: wrong ({AGREEMENT.pooled.humanIncorrect})
              </th>
              {cell(t.judgeTooLenient, false)}
              {cell(t.bothIncorrect, true)}
            </tr>
          </tbody>
        </table>
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
          {[
            {
              label: 'judge too lenient',
              v: lenient,
              set: setLenient,
              max: AGREEMENT.pooled.humanIncorrect,
            },
            {
              label: 'judge too strict',
              v: strict,
              set: setStrict,
              max: AGREEMENT.pooled.humanCorrect,
            },
          ].map((c) => (
            <label key={c.label} className="block">
              <span className="flex justify-between text-muted-foreground">
                {c.label} <span className="font-mono text-foreground">{c.v}</span>
              </span>
              <input
                type="range"
                min={0}
                max={c.max}
                value={c.v}
                onChange={(e) => {
                  c.set(Number(e.target.value));
                }}
                className="mt-1 w-full accent-[var(--accent)]"
                aria-label={c.label}
              />
            </label>
          ))}
        </div>
      </div>
      <div className="text-sm">
        <Tex tex={KAPPA} />
        <dl className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-muted/50 p-3">
            <dt className="font-mono text-[10px] text-muted-foreground">raw agreement</dt>
            <dd className="text-xl font-semibold tabular-nums">{pct(agree)}</dd>
          </div>
          <div className="rounded-lg bg-muted/50 p-3">
            <dt className="font-mono text-[10px] text-muted-foreground">Cohen’s κ</dt>
            <dd className="text-xl font-semibold tabular-nums">
              {k === null ? 'undefined' : k.toFixed(2)}
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">
          {n} judged answers were labelled blind by hand, 10 from the test split and 30 from
          LongMemEval. The real sheet has no disagreement: κ 1.00. Drag the sliders to see why κ,
          not raw agreement, is the honest number: with {AGREEMENT.pooled.humanCorrect} of {n}{' '}
          answers correct, a judge that disagrees on a few wrong answers keeps high raw agreement
          while κ falls fast. The test split’s own sheet is one-class (all 10 correct), so its κ is
          undefined, not 1.
        </p>
      </div>
    </div>
  );
}

export function Benchmarks() {
  const [ri, setRi] = useState(1);
  const run = RUNS[ri];
  if (!run) return null;
  const modes = orderedModes(Object.keys(run.modes));
  const groups = Object.entries(run.categories).map(([c, byMode]) => ({
    key: c,
    label: CATEGORY_LABEL[c] ?? c,
    values: Object.fromEntries(modes.map((m) => [m, byMode[m]?.accuracy ?? null])),
    n: Object.values(byMode)[0]?.n,
  }));
  const fc = run.modes.full_context;
  return (
    <div>
      <p className="max-w-3xl text-muted-foreground">
        Engram is measured against three baselines on the same composer: the last 20 turns (buffer),
        the top 8 turns by similarity (rag, the RAG lineage
        <Cite k="lewis2020" />) and the whole history (full context). Everything was tuned on a dev
        split; the test split was run once, and LongMemEval-S
        <Cite k="wu2024" /> is the external check. An LLM judge grades answers
        <Cite k="zheng2023" />, and the judge itself is checked against hand labels.
      </p>

      <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Benchmark run">
        {RUNS.map((r, i) => (
          <button
            key={r.runId}
            role="tab"
            aria-selected={ri === i}
            onClick={() => {
              setRi(i);
            }}
            className={cn(
              'rounded-md border px-2.5 py-1 text-xs',
              ri === i ? 'border-accent bg-accent/10' : 'text-muted-foreground',
            )}
          >
            {SPLIT_LABEL[r.split] ?? r.split} · {r.items} items
          </button>
        ))}
      </div>

      <div className="mt-3 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Legend modes={modes} />
          <p className="font-mono text-[10px] text-muted-foreground">{run.model}</p>
        </div>
        <div className="mt-2">
          <GroupedBars groups={groups} modes={modes} />
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
          {modes.map((m) => (
            <li key={m}>
              <span className="text-muted-foreground">{MODE_STYLE[m]?.label ?? m}</span>{' '}
              <span className="font-mono font-semibold">{pct(run.modes[m]?.accuracy ?? 0)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 grid gap-4 text-sm lg:grid-cols-2">
        <div className="rounded-lg border p-4">
          <h3 className="font-medium">Why the test split saturates</h3>
          <p className="mt-1 text-muted-foreground">
            Its histories have a median of 48 turns: small enough that one prompt holds all of them,
            so rag, full context and Engram all score about 100% and only buffer, which forgets,
            falls behind. It proves the engine is correct end to end, not that memory helps.
            LongMemEval’s ~470-turn histories (~115k tokens) are the discriminating test.
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <h3 className="font-medium">LongMemEval, read honestly</h3>
          <p className="mt-1 text-muted-foreground">
            Long prompts degrade: models miss what sits in the middle of a long context
            <Cite k="liu2023" />, and LongMemEval shows the same drop for chat histories
            <Cite k="wu2024" />. Even so, full context ({pct(fc?.accuracy ?? 0)}) and rag beat
            Engram here. Engram distills about 25 facts from 470 turns, while these questions mostly
            ask about one throwaway turn. And two quota-forced handicaps, local embeddings and
            packed extraction, cost about 5 points each on dev-long. Nothing was tuned on
            LongMemEval to close the gap.
          </p>
        </div>
      </div>

      <h3 className="mt-10 text-lg font-semibold">What each answer costs</h3>
      <div className="mt-3 rounded-lg border bg-card p-4">
        <Legend modes={orderedModes(RUNS.flatMap((r) => Object.keys(r.modes)))} />
        <div className="mt-2">
          <CostScatter />
        </div>
      </div>

      <h3 className="mt-10 text-lg font-semibold">Is the judge right?</h3>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        Agreement is measured with Cohen’s κ, which discounts the agreement two raters would reach
        by chance
        <Cite k="cohen1960" />. The judge is Groq’s gpt-oss-120b, not the paper’s GPT-4o, so its
        verdicts needed checking.
      </p>
      <div className="mt-3 rounded-lg border bg-card p-4">
        <Agreement />
      </div>
    </div>
  );
}
