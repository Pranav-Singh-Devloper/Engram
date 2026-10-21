'use client';

import 'katex/dist/katex.min.css';
import { area, line, scaleLinear } from 'd3';
import katex from 'katex';
import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Cite } from '../cite';
import { useWidth } from '../use-width';
import { DECAY, STATIC_PREDICATES, crossingWithAccess, scoreAfter, tauDays } from '../data/decay';
import type { Tier } from '../data/decay';

const H = 300;
const M = { top: 16, right: 20, bottom: 34, left: 40 };
const DAYS = 400;

const FORMULA = String.raw`\text{score} = 0.50\,e^{-\Delta t/\tau_{\text{tier}}} + 0.25\,\min\!\left(1,\ \frac{\ln(1+a)}{\ln 21}\right) + 0.25\cdot\text{importance}`;
const ACCESS = String.raw`a \leftarrow a\,e^{-\Delta t_{\text{sweep}}/\tau_{\text{tier}}}\ \ (+1\ \text{per access})\qquad \tau_{\text{working}} = 14\text{ d},\ \tau_{\text{long\_term}} = 90\text{ d},\ \theta = 0.15`;
// Phone widths: the same formulas broken over lines.
const FORMULA_STACKED = String.raw`\begin{aligned}\text{score} &= 0.50\,e^{-\Delta t/\tau_{\text{tier}}}\\ &+ 0.25\,\min\!\left(1,\ \tfrac{\ln(1+a)}{\ln 21}\right)\\ &+ 0.25\cdot\text{importance}\end{aligned}`;
const ACCESS_STACKED = String.raw`\begin{aligned}&a \leftarrow a\,e^{-\Delta t_{\text{sweep}}/\tau_{\text{tier}}}\ \ (+1\ \text{per access})\\ &\tau_{\text{working}} = 14\text{ d},\ \tau_{\text{long\_term}} = 90\text{ d},\ \theta = 0.15\end{aligned}`;
const INVARIANT_STACKED = String.raw`\begin{aligned}&\lim_{\Delta t\to\infty}\text{score} = 0.25\cdot\text{importance}\\ &\Rightarrow\ \text{archivable} \iff \text{importance} < 0.6\end{aligned}`;
const INVARIANT = String.raw`\lim_{\Delta t\to\infty}\text{score} = 0.25\cdot\text{importance}\ \Rightarrow\ \text{archivable} \iff \text{importance} < \theta/0.25 = 0.6`;

/** The wide form from sm up, the stacked form below it. */
function Formula({ wide, narrow }: { wide: string; narrow: string }) {
  return (
    <>
      <div className="hidden sm:block">
        <Tex tex={wide} />
      </div>
      <div className="sm:hidden">
        <Tex tex={narrow} />
      </div>
    </>
  );
}

function Tex({ tex, display = true }: { tex: string; display?: boolean }) {
  const html = useMemo(
    () => katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'html' }),
    [tex, display],
  );
  return <div className="overflow-x-auto py-1" dangerouslySetInnerHTML={{ __html: html }} />;
}

const TIER_STYLE: Record<Tier, { label: string; color: string }> = {
  working: { label: 'working (τ = 14 d)', color: 'var(--record)' },
  long_term: { label: 'long_term (τ = 90 d)', color: 'var(--valid)' },
};

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  fmt,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  fmt: (v: number) => string;
}) {
  return (
    <label className="block text-xs">
      <span className="flex justify-between text-muted-foreground">
        {label} <span className="font-mono text-foreground">{fmt(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          onChange(Number(e.target.value));
        }}
        className="mt-1 w-full accent-[var(--accent)]"
        aria-label={label}
      />
    </label>
  );
}

export function Decay() {
  const [box, W] = useWidth<HTMLDivElement>();
  const [importance, setImportance] = useState(0.5);
  const [access, setAccess] = useState(0);
  const [stackTier, setStackTier] = useState<Tier>('working');
  const x = scaleLinear()
    .domain([0, DAYS])
    .range([M.left, W - M.right]);
  const y = scaleLinear()
    .domain([0, 1])
    .range([H - M.bottom, M.top]);
  const days = Array.from({ length: 201 }, (_, i) => (i / 200) * DAYS);
  const curve = (tier: Tier) =>
    line<number>()
      .x((d) => x(d))
      .y((d) => y(scoreAfter(importance, access, d, tier).score))(days) ?? '';
  // The selected tier's three terms, stacked: importance at the bottom, then access, then recency.
  const band = (lo: (d: number) => number, hi: (d: number) => number) =>
    area<number>()
      .x((d) => x(d))
      .y0((d) => y(lo(d)))
      .y1((d) => y(hi(d)))(days) ?? '';
  const t = (d: number) => scoreAfter(importance, access, d, stackTier);
  const crossing = (tier: Tier) => crossingWithAccess(importance, access, tier);
  const permanent = DECAY.importanceWeight * importance >= DECAY.archiveThreshold;

  return (
    <div>
      <p className="max-w-3xl text-muted-foreground">
        Memory that never forgets drowns in trivia. Engram scores every current belief each night
        and archives the ones nobody needs: a recency term that falls off exponentially, the shape
        of Ebbinghaus’s forgetting curve
        <Cite k="ebbinghaus1885" />; an access term that recall reinforces, as in MemoryBank
        <Cite k="zhong2024" />; and the importance the extractor assigned. Generative Agents combine
        the same three signals to rank retrieval
        <Cite k="park2023" />; Engram uses them to decide what to keep. Archiving is reversible: an
        archived fact leaves default recall but comes back on an <code>include_archived</code> hit.
      </p>

      <div className="mt-6 rounded-lg border bg-card px-4 py-3 text-sm">
        <Formula wide={FORMULA} narrow={FORMULA_STACKED} />
        <Formula wide={ACCESS} narrow={ACCESS_STACKED} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_16rem]">
        <div ref={box} className="rounded-lg border bg-card p-3">
          <svg
            viewBox={`0 0 ${String(W)} ${String(H)}`}
            className="w-full"
            role="img"
            aria-label="Retention score over days since last access, per tier"
          >
            <path
              d={band(
                () => 0,
                (d) => t(d).importance,
              )}
              fill="var(--muted-foreground)"
              opacity={0.18}
            />
            <path
              d={band(
                (d) => t(d).importance,
                (d) => t(d).importance + t(d).access,
              )}
              fill="var(--success)"
              opacity={0.18}
            />
            <path
              d={band(
                (d) => t(d).importance + t(d).access,
                (d) => t(d).score,
              )}
              fill={TIER_STYLE[stackTier].color}
              opacity={0.16}
            />
            {[0, 0.25, 0.5, 0.75, 1].map((v) => (
              <g key={v}>
                <line
                  x1={M.left}
                  x2={W - M.right}
                  y1={y(v)}
                  y2={y(v)}
                  stroke="var(--border)"
                  strokeDasharray="2 4"
                />
                <text
                  x={M.left - 6}
                  y={y(v) + 3}
                  textAnchor="end"
                  className="fill-muted-foreground font-mono text-[10px]"
                >
                  {v}
                </text>
              </g>
            ))}
            {(W < 520 ? [0, 42, 90, 180, 270, 365] : [0, 14, 42, 90, 180, 270, 365]).map((d) => (
              <text
                key={d}
                x={x(d)}
                y={H - 14}
                textAnchor="middle"
                className="fill-muted-foreground font-mono text-[10px]"
              >
                {d}
              </text>
            ))}
            <text
              x={W - M.right}
              y={H - 2}
              textAnchor="end"
              className="fill-muted-foreground text-[10px]"
            >
              days since last access
            </text>
            <line
              x1={M.left}
              x2={W - M.right}
              y1={y(DECAY.archiveThreshold)}
              y2={y(DECAY.archiveThreshold)}
              stroke="var(--danger)"
              strokeWidth={1.5}
            />
            {W >= 560 && (
              <text
                x={W - M.right}
                y={y(DECAY.archiveThreshold) - 5}
                textAnchor="end"
                className="fill-danger font-mono text-[10px]"
              >
                θ = {DECAY.archiveThreshold}: archived below
              </text>
            )}
            <line
              x1={M.left}
              x2={W - M.right}
              y1={y(DECAY.importanceWeight * importance)}
              y2={y(DECAY.importanceWeight * importance)}
              stroke="var(--foreground)"
              strokeDasharray="4 4"
              opacity={0.35}
            />
            {(['working', 'long_term'] as Tier[]).map((tier) => {
              const c = crossing(tier);
              return (
                <g key={tier}>
                  <path
                    d={curve(tier)}
                    fill="none"
                    stroke={TIER_STYLE[tier].color}
                    strokeWidth={2.5}
                  />
                  {Number.isFinite(c) && c <= DAYS && (
                    <g>
                      <circle
                        cx={x(c)}
                        cy={y(DECAY.archiveThreshold)}
                        r={5}
                        fill={TIER_STYLE[tier].color}
                      />
                      <text
                        x={x(c)}
                        y={y(DECAY.archiveThreshold) + (tier === 'working' ? 18 : -10)}
                        textAnchor="middle"
                        className="font-mono text-[10px]"
                        fill={TIER_STYLE[tier].color}
                      >
                        day {Math.round(c)}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[11px] text-muted-foreground">
            {(['working', 'long_term'] as Tier[]).map((tier) => (
              <li key={tier} className="inline-flex items-center gap-1.5">
                <span className="h-0.5 w-4" style={{ background: TIER_STYLE[tier].color }} />
                {TIER_STYLE[tier].label}
              </li>
            ))}
            <li>shaded: the {stackTier} score’s terms (importance · access · recency)</li>
            <li>dashed: the floor, 0.25 · importance</li>
            {W < 560 && (
              <li className="text-danger">red: θ = {DECAY.archiveThreshold}, archived below</li>
            )}
          </ul>
        </div>
        <div className="space-y-4 rounded-lg border bg-card p-4">
          <Slider
            label="importance"
            value={importance}
            min={0}
            max={1}
            step={0.01}
            onChange={setImportance}
            fmt={(v) => v.toFixed(2)}
          />
          <Slider
            label="access score at day 0"
            value={access}
            min={0}
            max={40}
            step={0.5}
            onChange={setAccess}
            fmt={(v) => v.toFixed(1)}
          />
          <div className="flex gap-1">
            {(['working', 'long_term'] as Tier[]).map((tier) => (
              <button
                key={tier}
                onClick={() => {
                  setStackTier(tier);
                }}
                className={cn(
                  'flex-1 rounded-md border px-2 py-1 font-mono text-[11px]',
                  stackTier === tier ? 'border-accent bg-accent/10' : 'text-muted-foreground',
                )}
              >
                {tier}
              </button>
            ))}
          </div>
          <dl className="space-y-2 text-xs">
            {(['working', 'long_term'] as Tier[]).map((tier) => {
              const c = crossing(tier);
              return (
                <div key={tier} className="flex justify-between">
                  <dt className="text-muted-foreground">archived ({tier})</dt>
                  <dd className="font-mono">
                    {Number.isFinite(c) ? `day ${String(Math.round(c))}` : 'never'}
                  </dd>
                </div>
              );
            })}
          </dl>
          <p
            className={cn(
              'rounded-md p-2 text-xs',
              permanent ? 'bg-success/10 text-success' : 'bg-muted/50 text-muted-foreground',
            )}
          >
            {permanent
              ? 'Importance ≥ 0.6: the floor sits above θ, so decay never archives it.'
              : `Importance < 0.6: it crosses θ after about ${String(Math.round(crossing('working') / tauDays('working')))}τ unless recall touches it.`}
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-lg border p-4">
          <h3 className="font-medium">The invariant the tests assert</h3>
          <div className="mt-1 text-xs">
            <Formula wide={INVARIANT} narrow={INVARIANT_STACKED} />
          </div>
          <p className="mt-1 text-muted-foreground">
            A default-importance fact (0.5) that’s never recalled crosses after about 3τ: day{' '}
            {Math.round(crossingWithAccess(0.5, 0, 'working'))} in working, day{' '}
            {Math.round(crossingWithAccess(0.5, 0, 'long_term'))} in long_term. Only consolidation
            promotes a fact to long_term (chapter 8), so facts confirmed across sessions last about
            six times longer.
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <h3 className="font-medium">Never archived by decay</h3>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            <li>pinned facts;</li>
            <li>
              static predicates:{' '}
              {STATIC_PREDICATES.map((p, i) => (
                <span key={p}>
                  {i > 0 && ', '}
                  <code className="font-mono text-xs">{p}</code>
                </span>
              ))}
              ;
            </li>
            <li>the user’s own name;</li>
            <li>replaced versions, which aren’t current beliefs and are never scored.</li>
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            The sweep is one SQL function with <code>now</code> as a parameter, so tests run it on a
            simulated clock. It clamps exponents at −700, because Postgres raises on an underflowing
            double instead of returning 0 (SPEC §9.1).
          </p>
        </div>
      </div>
    </div>
  );
}
