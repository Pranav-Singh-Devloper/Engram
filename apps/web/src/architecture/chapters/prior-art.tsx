'use client';

import { scaleLinear } from 'd3';
import { motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { REFERENCES } from '@/content/references';
import { cn } from '@/lib/utils';
import { Cite } from '../cite';
import { CAPABILITIES, ENGRAM, ROLE, SYSTEMS, yearOf } from '../data/prior-art';
import type { Capability, Level, System } from '../data/prior-art';
import { useWidth } from '../use-width';

const ROLE_STYLE: Record<string, { label: string; color: string }> = {
  theory: { label: 'theory', color: 'var(--record)' },
  method: { label: 'method', color: 'var(--valid)' },
  model: { label: 'model', color: 'var(--success)' },
  system: { label: 'memory system', color: 'var(--accent)' },
  benchmark: { label: 'benchmark', color: 'var(--danger)' },
};

/** 1880–2015 compressed into the first 40%, the last decade spread over the rest. */
function Timeline() {
  const still = useReducedMotion();
  const [box, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const x = scaleLinear()
    .domain([1880, 2015, 2026])
    .range([16, 16 + (W - 32) * 0.4, W - 16]);
  // Same-year works stack upward.
  const seen = new Map<number, number>();
  const dots = REFERENCES.map((r) => {
    const y = yearOf(r.key);
    const n = seen.get(y) ?? 0;
    seen.set(y, n + 1);
    return { r, year: y, level: n };
  });
  const H = 40 + Math.max(...dots.map((d) => d.level)) * 16 + 40;
  const base = H - 30;
  const hovered = REFERENCES.find((r) => r.key === hover);
  return (
    <div ref={box}>
      <svg width={W} height={H} role="img" aria-label="Every cited work by year">
        <line x1={16} x2={W - 16} y1={base} y2={base} stroke="var(--border)" />
        {(W < 560
          ? [1885, 1985, 2016, 2025]
          : [1885, 1960, 1985, 2009, 2016, 2020, 2023, 2025]
        ).map((y) => (
          <text
            key={y}
            x={x(y)}
            y={base + 18}
            textAnchor="middle"
            className="fill-muted-foreground font-mono text-[10px]"
          >
            {y}
          </text>
        ))}
        <line
          x1={x(2015)}
          x2={x(2015)}
          y1={base - 6}
          y2={base + 6}
          stroke="var(--muted-foreground)"
          strokeDasharray="2 2"
        />
        {dots.map((d, i) => {
          const role = ROLE_STYLE[ROLE[d.r.key] ?? 'method'];
          return (
            <motion.a
              key={d.r.key}
              href={`#ref-${d.r.key}`}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={still ? { duration: 0 } : { duration: 0.4, delay: i * 0.03 }}
              onMouseEnter={() => {
                setHover(d.r.key);
              }}
              onMouseLeave={() => {
                setHover(null);
              }}
              onFocus={() => {
                setHover(d.r.key);
              }}
            >
              <circle
                cx={x(d.year)}
                cy={base - 12 - d.level * 16}
                r={hover === d.r.key ? 7 : 5.5}
                fill={role?.color}
                stroke="var(--background)"
                strokeWidth={1.5}
              />
            </motion.a>
          );
        })}
      </svg>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          {Object.values(ROLE_STYLE).map((r) => (
            <li key={r.label} className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-full" style={{ background: r.color }} />
              {r.label}
            </li>
          ))}
        </ul>
        <p className="min-h-10 max-w-xl text-xs">
          {hovered ? (
            <>
              <span className="font-medium">{hovered.title}</span>{' '}
              <span className="text-muted-foreground">
                ({hovered.authors}, {hovered.venue}). {hovered.took}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">
              Hover a work; click it for the full reference. Before 2015 the axis is compressed.
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

function Mark({ level }: { level: Level }) {
  return (
    <span
      aria-label={level}
      className={cn(
        'inline-block size-3.5 rounded-full border-2',
        level === 'yes' && 'border-accent bg-accent',
        level === 'partial' &&
          'border-accent bg-[linear-gradient(90deg,var(--accent)_50%,transparent_50%)]',
        level === 'no' && 'border-muted-foreground/40',
      )}
    />
  );
}

function Detail({ s }: { s: System }) {
  return (
    <div className="grid gap-3 text-sm sm:grid-cols-3">
      {[
        { h: 'What Engram took', t: s.adopted, c: 'text-success' },
        { h: 'Where it differs', t: s.differs, c: 'text-valid' },
        { h: 'What Engram lacks', t: s.lacks, c: 'text-record' },
      ].map((b) => (
        <div key={b.h} className="rounded-lg border bg-card p-3">
          <p className={cn('font-mono text-[11px]', b.c)}>{b.h}</p>
          <p className="mt-1">{b.t}</p>
        </div>
      ))}
      <p className="text-xs text-muted-foreground sm:col-span-3">
        Evaluated on: {s.benchmarks}. <Cite k={s.ref} />
      </p>
    </div>
  );
}

export function PriorArt() {
  const [picked, setPicked] = useState(SYSTEMS.findIndex((s) => s.ref === 'rasmussen2025'));
  const [cap, setCap] = useState<Capability | null>(null);
  const [cell, setCell] = useState<{ row: string; cap: Capability } | null>(null);
  const rows = [...SYSTEMS, ENGRAM];
  const rank = { yes: 0, partial: 1, no: 2 };
  const ordered = cap
    ? [...rows].sort((a, b) => rank[a.cells[cap].level] - rank[b.cells[cap].level])
    : rows;
  const system = SYSTEMS[picked];
  const shownCell = cell ? rows.find((r) => r.name === cell.row)?.cells[cell.cap] : undefined;
  return (
    <div>
      <p className="max-w-3xl text-muted-foreground">
        Engram stands on decades of work: forgetting curves, episodic and semantic memory, temporal
        databases, rank fusion, and a recent wave of LLM memory systems. The comparison below was
        checked against each paper’s own text, not recalled. “No” means the paper doesn’t describe
        it, and each row says what Engram lacks as plainly as what it took.
      </p>

      <div className="mt-6 rounded-lg border bg-card p-4">
        <Timeline />
      </div>

      <h3 className="mt-10 text-lg font-semibold">Seven memory systems, six capabilities</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Click a column to sort by it, a row for the full comparison, a mark for its evidence.
      </p>
      <div className="mt-3 overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-normal text-muted-foreground">system</th>
              {CAPABILITIES.map((c) => (
                <th key={c.key} className="px-2 py-2 font-normal">
                  <button
                    onClick={() => {
                      setCap(cap === c.key ? null : c.key);
                    }}
                    title={c.what}
                    className={cn(
                      'rounded px-1.5 py-0.5',
                      cap === c.key
                        ? 'bg-accent/15 text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {c.label}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ordered.map((s) => {
              const i = SYSTEMS.indexOf(s);
              const isEngram = s === ENGRAM;
              return (
                <tr
                  key={s.name}
                  onClick={() => {
                    if (!isEngram) setPicked(i);
                  }}
                  className={cn(
                    'border-t transition-colors',
                    isEngram ? 'bg-accent/5 font-medium' : 'cursor-pointer hover:bg-muted/40',
                    i === picked && 'bg-muted/60',
                  )}
                >
                  <td className="px-3 py-2">
                    {s.name}
                    {!isEngram && <Cite k={s.ref} />}
                    <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                      {s.year}
                    </span>
                  </td>
                  {CAPABILITIES.map((c) => (
                    <td key={c.key} className="px-2 py-2 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setCell({ row: s.name, cap: c.key });
                        }}
                        className="rounded p-1 hover:bg-muted"
                        aria-label={`${s.name}, ${c.label}: ${s.cells[c.key].level}`}
                      >
                        <Mark level={s.cells[c.key].level} />
                      </button>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 min-h-5 text-xs">
        {cell && shownCell ? (
          <>
            <span className="font-medium">{cell.row}</span>
            <span className="text-muted-foreground">
              {' '}
              · {CAPABILITIES.find((c) => c.key === cell.cap)?.label}:{' '}
            </span>
            {shownCell.note}
          </>
        ) : (
          <span className="text-muted-foreground">● yes · ◐ partial · ○ not described</span>
        )}
      </p>

      {system && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium">{system.name}</p>
          <Detail s={system} />
        </div>
      )}

      <div className="mt-8 grid gap-3 text-sm lg:grid-cols-2">
        <div className="rounded-lg border p-4">
          <h3 className="font-medium">Benchmarks: which one, and why</h3>
          <p className="mt-1 text-muted-foreground">
            LoCoMo’s conversations average about 300 turns and 9K tokens over up to 35 sessions
            <Cite k="maharana2024" />; Mem0 and A-MEM report on it. LongMemEval’s histories are
            about 115k tokens, with abstention and knowledge-update categories that test what Engram
            claims
            <Cite k="wu2024" />; Zep reports on it. Engram ran LongMemEval-S (98 items) and not
            LoCoMo, so its numbers can’t be set beside Mem0’s or A-MEM’s.
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <h3 className="font-medium">What Engram doesn’t have</h3>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
            {SYSTEMS.map((s) => (
              <li key={s.name}>
                <span className="text-foreground">{s.name}:</span> {s.lacks}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
