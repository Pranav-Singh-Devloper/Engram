'use client';

import { scaleLinear } from 'd3';
import { useReducedMotion } from 'motion/react';
import { useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Cite } from '../cite';
import { useWidth } from '../use-width';
import {
  CALIBRATIONS,
  FAMILY_INFO,
  FAMILY_NAMES,
  PROFILES,
  errorsAt,
  modelOf,
} from '../data/calibration';
import type { Calibration, Family } from '../data/calibration';

const M = { left: 16, right: 16 };
const pct = (x: number) => `${(x * 100).toFixed(x > 0 && x < 0.1 ? 1 : 0)}%`;

/** Dots stacked in score bins, positives growing up from the axis and negatives down. */
function stack(values: number[], x: (v: number) => number, r: number) {
  const bins = new Map<number, number>();
  return values.map((v) => {
    const bin = Math.round(x(v) / (2 * r + 1));
    const n = bins.get(bin) ?? 0;
    bins.set(bin, n + 1);
    return { v, cx: bin * (2 * r + 1), level: n };
  });
}

function Ladder({ family }: { family: Family }) {
  const rungs: { label: string; families: Family[] }[] = [
    { label: 'exact name', families: [] },
    { label: 'learned alias', families: [] },
    { label: 'embedding ≥ entity match', families: ['entityMatch'] },
    { label: 'same name, description check', families: ['descriptionConflict'] },
    { label: 'LLM disambiguation', families: [] },
    { label: 'new entity', families: [] },
  ];
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-xs">
      {rungs.map((r, i) => (
        <li key={r.label} className="flex items-center gap-1.5">
          <span
            className={cn(
              'rounded-md border px-2 py-1 font-mono transition-colors',
              r.families.includes(family)
                ? 'border-accent bg-accent/15 text-foreground'
                : 'text-muted-foreground',
            )}
          >
            {r.label}
          </span>
          {i < rungs.length - 1 && <span className="text-muted-foreground">→</span>}
        </li>
      ))}
    </ol>
  );
}

function DotPlot({ cal, family }: { cal: Calibration; family: Family }) {
  const [box, W] = useWidth<HTMLDivElement>();
  const still = useReducedMotion();
  const scores = cal.scores?.[family];
  const profile = PROFILES[modelOf(cal.space)]?.[family] ?? 0.5;
  const sum = cal.families[family];
  const [t, setT] = useState(profile);
  const [lastFamily, setLastFamily] = useState(family);
  if (lastFamily !== family) {
    setLastFamily(family);
    setT(profile);
  }
  const svg = useRef<SVGSVGElement>(null);
  const all = scores ? [...scores.positive, ...scores.negative] : [];
  const lo = Math.floor((Math.min(...all, profile) - 0.01) * 100) / 100;
  const hi = Math.min(1, Math.ceil((Math.max(...all, profile) + 0.005) * 100) / 100);
  const x = useMemo(
    () =>
      scaleLinear()
        .domain([lo, hi])
        .range([M.left, W - M.right]),
    [lo, hi, W],
  );
  if (!scores) return null;
  const r = scores.positive.length > 100 ? 2.6 : 3.6;
  const pos = stack(scores.positive, x, r);
  const neg = stack(scores.negative, x, r);
  const step = 2 * r + 1;
  const up = Math.max(1, ...pos.map((d) => d.level + 1)) * step;
  const down = Math.max(1, ...neg.map((d) => d.level + 1)) * step;
  const axisY = 24 + up;
  const H = axisY + down + 44;
  const e = errorsAt(scores, t);
  const info = FAMILY_INFO[family];

  const fromPointer = (clientX: number) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return;
    const v = x.invert(((clientX - box.left) / box.width) * W);
    setT(Math.round(Math.min(hi, Math.max(lo, v)) * 1000) / 1000);
  };
  const ease = still ? undefined : 'transform 450ms cubic-bezier(0.22, 1, 0.36, 1)';

  return (
    <div ref={box}>
      <svg
        ref={svg}
        viewBox={`0 0 ${String(W)} ${String(H)}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label={`${info.label}: ${String(scores.positive.length)} positive and ${String(scores.negative.length)} negative pairs by cosine similarity`}
        onPointerDown={(ev) => {
          ev.currentTarget.setPointerCapture(ev.pointerId);
          fromPointer(ev.clientX);
        }}
        onPointerMove={(ev) => {
          if (ev.buttons === 1) fromPointer(ev.clientX);
        }}
      >
        <rect
          x={x(t)}
          y={8}
          width={Math.max(0, W - M.right - x(t))}
          height={H - 44}
          fill="var(--accent)"
          opacity={0.06}
        />
        {x.ticks(Math.max(3, Math.floor(W / 90))).map((v) => (
          <g key={v}>
            <line x1={x(v)} x2={x(v)} y1={axisY} y2={axisY + 4} stroke="var(--muted-foreground)" />
            <text
              x={x(v)}
              y={H - 22}
              textAnchor="middle"
              className="fill-muted-foreground font-mono text-[10px]"
            >
              {v.toFixed(2)}
            </text>
          </g>
        ))}
        <line x1={M.left} x2={W - M.right} y1={axisY} y2={axisY} stroke="var(--border)" />
        {pos.map((d, i) => {
          const miss = d.v < t;
          return (
            <circle
              key={`p${String(i)}`}
              r={r}
              cx={0}
              cy={0}
              fill={miss ? 'var(--record)' : 'var(--success)'}
              style={{
                transform: `translate(${String(d.cx)}px, ${String(axisY - 2 - r - d.level * step)}px)`,
                transition: ease,
              }}
            >
              <title>{`positive · ${d.v.toFixed(3)}`}</title>
            </circle>
          );
        })}
        {neg.map((d, i) => {
          const wrong = d.v >= t;
          return (
            <circle
              key={`n${String(i)}`}
              r={r}
              cx={0}
              cy={0}
              fill={wrong ? 'var(--danger)' : 'var(--muted-foreground)'}
              opacity={wrong ? 1 : 0.55}
              style={{
                transform: `translate(${String(d.cx)}px, ${String(axisY + 2 + r + d.level * step)}px)`,
                transition: ease,
              }}
            >
              <title>{`negative · ${d.v.toFixed(3)}`}</title>
            </circle>
          );
        })}
        <line
          x1={x(profile)}
          x2={x(profile)}
          y1={8}
          y2={H - 36}
          stroke="var(--foreground)"
          strokeDasharray="2 3"
          opacity={0.5}
        />
        <line
          x1={x(t)}
          x2={x(t)}
          y1={4}
          y2={H - 36}
          stroke="var(--accent)"
          strokeWidth={2}
          className="cursor-ew-resize"
        />
        <circle cx={x(t)} cy={8} r={6} fill="var(--accent)" className="cursor-ew-resize" />
        <text x={M.left} y={18} className="fill-success text-[10px]">
          ▲ {info.positive} ({scores.positive.length})
        </text>
        <text x={M.left} y={H - 6} className="fill-muted-foreground text-[10px]">
          ▼ {info.negative} ({scores.negative.length})
        </text>
        {W >= 560 && (
          <text
            x={W - M.right}
            y={H - 6}
            textAnchor="end"
            className="fill-muted-foreground text-[10px]"
          >
            cosine similarity · dashed: the engine’s value
          </text>
        )}
      </svg>
      {W < 560 && (
        <p className="text-[10px] text-muted-foreground">
          cosine similarity · dashed: the engine’s value
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          threshold
          <input
            type="range"
            min={lo}
            max={hi}
            step="any"
            value={t}
            onChange={(ev) => {
              setT(Number(ev.target.value));
            }}
            className="w-40 accent-[var(--accent)]"
            aria-label="Threshold"
          />
          <span className="font-mono text-foreground tabular-nums">{t.toFixed(3)}</span>
        </label>
        <button
          onClick={() => {
            setT(profile);
          }}
          className="rounded-md border px-2 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
        >
          engine: {profile}
        </button>
        <button
          onClick={() => {
            setT(sum.suggested.threshold);
          }}
          className="rounded-md border px-2 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
        >
          ≤ {pct(cal.maxFalse)} false: {sum.suggested.threshold}
        </button>
      </div>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border bg-card p-3">
          <dt className="font-mono text-[11px] text-danger">
            false positives · {pct(e.falsePositive)}
          </dt>
          <dd className="mt-1 text-sm">{info.fp}</dd>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <dt className="font-mono text-[11px] text-record">
            false negatives · {pct(e.falseNegative)}
          </dt>
          <dd className="mt-1 text-sm">{info.fn}</dd>
        </div>
      </dl>
    </div>
  );
}

/** A fallback for a model whose per-pair scores weren't recorded: summary ranges only. */
function Bands({ cal, family }: { cal: Calibration; family: Family }) {
  const [box, W] = useWidth<HTMLDivElement>();
  const s = cal.families[family];
  const profile = PROFILES[modelOf(cal.space)]?.[family] ?? 0;
  const lo =
    Math.floor((Math.min(s.negativeRange[0], s.positiveRange[0], profile) - 0.02) * 20) / 20;
  const hi = Math.min(1, Math.ceil((Math.max(s.positiveRange[1], profile) + 0.01) * 20) / 20);
  const x = scaleLinear()
    .domain([lo, hi])
    .range([M.left, W - M.right]);
  const band = (range: [number, number], y: number, fill: string, label: string) => (
    <g>
      <rect
        x={x(range[0])}
        y={y}
        width={Math.max(3, x(range[1]) - x(range[0]))}
        height={18}
        rx={4}
        fill={fill}
        opacity={0.75}
      />
      <text x={x(range[0])} y={y - 4} className="fill-muted-foreground text-[10px]">
        {label} {range[0].toFixed(3)}–{range[1].toFixed(3)}
      </text>
    </g>
  );
  return (
    <div ref={box}>
      <svg viewBox={`0 0 ${String(W)} 130`} className="w-full" role="img" aria-label="ranges">
        {band(s.positiveRange, 22, 'var(--success)', FAMILY_INFO[family].positive)}
        {band(s.negativeRange, 70, 'var(--muted-foreground)', FAMILY_INFO[family].negative)}
        <line
          x1={x(profile)}
          x2={x(profile)}
          y1={8}
          y2={100}
          stroke="var(--accent)"
          strokeWidth={2}
        />
        <text x={x(profile) + 4} y={100} className="fill-accent font-mono text-[10px]">
          profile {profile}
        </text>
        {x.ticks(Math.max(3, Math.floor(W / 90))).map((v) => (
          <text
            key={v}
            x={x(v)}
            y={124}
            textAnchor="middle"
            className="fill-muted-foreground font-mono text-[10px]"
          >
            {v.toFixed(2)}
          </text>
        ))}
      </svg>
      <p className="mt-2 text-xs text-muted-foreground">
        Ranges from the calibration summary. Per-pair scores for this model weren’t recorded; `pnpm
        bench:calibrate` writes them.
      </p>
    </div>
  );
}

export function Resolution() {
  const [space, setSpace] = useState('gemini-embedding-2');
  const [family, setFamily] = useState<Family>('entityMatch');
  const cal = CALIBRATIONS.find((c) => modelOf(c.space) === space);
  const gemma = CALIBRATIONS.find((c) => modelOf(c.space) === 'embeddinggemma:300m');
  if (!cal) return null;
  return (
    <div>
      <p className="max-w-3xl text-muted-foreground">
        “Sam”, “Samuel” and “my brother” may be one person or three. Each candidate entity climbs a
        ladder: exact name, a learned alias, embedding similarity, and only then an LLM
        disambiguation call. Mem0 and A-MEM likewise retrieve by similarity first and ask the model
        only about near matches
        <Cite k="chhikara2025" />
        <Cite k="xu2025" />. Every rung that compares vectors needs a threshold, and thresholds
        don’t transfer between embedders: on the same pairs, embeddinggemma
        <Cite k="vera2025" /> scores related labels about 0.15 lower than Gemini Embedding
        <Cite k="lee2025" />. So each model gets a profile, calibrated on {cal.pairs} labelled pairs
        built from the dev personas’ ground truth, never from test (ADR-017). Below, every dot is
        one real pair at its real cosine. Drag the line.
      </p>

      <div className="mt-6">
        <Ladder family={family} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {FAMILY_NAMES.map((f) => (
          <button
            key={f}
            onClick={() => {
              setFamily(f);
            }}
            className={cn(
              'rounded-md border px-2.5 py-1 text-xs',
              family === f ? 'border-accent bg-accent/10' : 'text-muted-foreground',
            )}
          >
            {FAMILY_INFO[f].label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        {['gemini-embedding-2', 'embeddinggemma:300m'].map((s) => (
          <button
            key={s}
            onClick={() => {
              setSpace(s);
            }}
            className={cn(
              'rounded-md border px-2.5 py-1 font-mono text-[11px]',
              space === s ? 'border-valid bg-valid/10' : 'text-muted-foreground',
            )}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="mt-4 rounded-lg border bg-card p-4">
        {cal.scores ? <DotPlot cal={cal} family={family} /> : <Bands cal={cal} family={family} />}
      </div>

      <div className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-lg border p-4">
          <h3 className="font-medium">What the data says about Gemini</h3>
          <ul className="mt-2 space-y-1.5 text-muted-foreground">
            <li>
              Entity match at 0.85 misses 42% of same-entity label pairs and admits 2 of 87
              different-entity pairs. Exact names and aliases run first, so dev-long still has 0%
              duplicate entities, and the value stays (ADR-017).
            </li>
            <li>
              Description conflict at 0.95 sends every same-name pair to the LLM: safe by design, at
              the cost of a call.
            </li>
            <li>
              Drift at 0.5 never splits a session: consecutive turns score ≥ 0.587. Sessions are
              split by their bounds instead.
            </li>
          </ul>
        </div>
        {gemma && (
          <div className="rounded-lg border p-4">
            <h3 className="font-medium">Why embeddinggemma has its own profile</h3>
            <p className="mt-2 text-muted-foreground">
              At Gemini’s values it would miss{' '}
              {pct(gemma.families.entityMatch.current.falseNegative)} of entity matches and find
              nothing in entity search ({pct(gemma.families.entitySearch.current.falseNegative)}{' '}
              missed). Its profile puts each threshold in the gap between the classes where one
              exists: entity match 0.775, entity search 0.335. Drift and the recall floor have no
              clean gap, so they sit low and the next stage absorbs the error.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
