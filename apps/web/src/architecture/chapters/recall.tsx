'use client';

import { scaleLinear } from 'd3';
import { motion, useReducedMotion } from 'motion/react';
import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Cite } from '../cite';
import { useWidth } from '../use-width';
import { LIST_NAMES, RECALL, rankLinear, rankRrf, simulateFloor } from '../data/recall';
import type { FloorRun, ListName, Trace } from '../data/recall';

const LIST_STYLE: Record<ListName, { label: string; color: string; what: string }> = {
  facts: { label: 'fact vectors', color: 'var(--valid)', what: 'HNSW over fact embeddings' },
  episodes: { label: 'episode vectors', color: 'var(--record)', what: 'HNSW over turn embeddings' },
  text: { label: 'full text', color: 'var(--success)', what: 'Postgres FTS, ts_rank' },
  graph: { label: 'entity graph', color: 'var(--accent)', what: 'one hop from the top seeds' },
};
const SHOWN = 12;

function Lists({
  trace,
  hover,
  setHover,
}: {
  trace: Trace;
  hover: string | null;
  setHover: (k: string | null) => void;
}) {
  const byKey = new Map(trace.candidates.map((c) => [c.key, c]));
  return (
    // Phones: a sideways snap scroller, one list per screen; wider screens: a grid.
    <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-4">
      {LIST_NAMES.map((n) => (
        <div
          key={n}
          className="w-[78%] min-w-0 shrink-0 snap-start rounded-lg border bg-card p-3 sm:w-auto"
        >
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <span className="size-2 rounded-sm" style={{ background: LIST_STYLE[n].color }} />
            {LIST_STYLE[n].label}
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
              {trace.lists[n].length}
            </span>
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">{LIST_STYLE[n].what}</p>
          <ol className="mt-2 space-y-0.5">
            {trace.lists[n].slice(0, 6).map((k, i) => (
              <li
                key={k}
                onMouseEnter={() => {
                  setHover(k);
                }}
                onMouseLeave={() => {
                  setHover(null);
                }}
                className={cn(
                  'flex gap-1.5 rounded px-1 py-0.5 text-[11px] transition-colors',
                  hover === k ? 'bg-accent/15 text-foreground' : 'text-muted-foreground',
                )}
              >
                <span className="w-3 shrink-0 text-right font-mono">{i + 1}</span>
                <span className="truncate">{byKey.get(k)?.text}</span>
              </li>
            ))}
            {trace.lists[n].length === 0 && (
              <li className="px-1 text-[11px] text-muted-foreground">nothing matched</li>
            )}
            {trace.lists[n].length > 6 && (
              <li className="px-1 text-[10px] text-muted-foreground">
                +{trace.lists[n].length - 6} more
              </li>
            )}
          </ol>
        </div>
      ))}
    </div>
  );
}

function Fused({
  trace,
  ranker,
  k,
  priors,
  hover,
  setHover,
}: {
  trace: Trace;
  ranker: 'rrf' | 'linear';
  k: number;
  priors: boolean;
  hover: string | null;
  setHover: (k: string | null) => void;
}) {
  const still = useReducedMotion();
  const ranked = (ranker === 'rrf' ? rankRrf(trace, k, priors) : rankLinear(trace)).slice(0, SHOWN);
  const max = Math.max(...ranked.map((r) => r.score), 1e-9);
  return (
    <ol className="space-y-1">
      {ranked.map((r, i) => (
        <motion.li
          key={r.c.key}
          layout={still ? false : 'position'}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          onMouseEnter={() => {
            setHover(r.c.key);
          }}
          onMouseLeave={() => {
            setHover(null);
          }}
          className={cn(
            'grid grid-cols-[1.5rem_1fr_auto] items-center gap-2 rounded-md px-2 py-1.5 text-xs',
            hover === r.c.key && 'bg-accent/10',
            i === RECALL.k && 'mt-4 border-t border-dashed pt-3',
            i >= RECALL.k && 'opacity-50',
          )}
        >
          <span className="text-right font-mono text-muted-foreground">{i + 1}</span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span
                className={cn(
                  'rounded px-1 font-mono text-[9px] uppercase',
                  r.c.kind === 'fact' ? 'bg-valid/15 text-valid' : 'bg-record/15 text-record',
                )}
              >
                {r.c.kind}
              </span>
              <span className="truncate">{r.c.text}</span>
            </span>
            <span className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-muted">
              {ranker === 'rrf' ? (
                LIST_NAMES.map((n) => (
                  <span
                    key={n}
                    className="h-full origin-left transition-[width] duration-300"
                    style={{
                      width: `${String(((r.parts[n] * r.multiplier) / max) * 100)}%`,
                      background: LIST_STYLE[n].color,
                    }}
                  />
                ))
              ) : (
                <span
                  className="h-full bg-foreground/60 transition-[width] duration-300"
                  style={{ width: `${String((r.score / max) * 100)}%` }}
                />
              )}
            </span>
          </span>
          <span className="text-right font-mono text-[10px] text-muted-foreground tabular-nums">
            {r.score.toFixed(ranker === 'rrf' ? 4 : 3)}
            <br />
            cos {r.c.similarity.toFixed(2)}
            {ranker === 'rrf' && priors && ` ×${r.multiplier.toFixed(2)}`}
          </span>
        </motion.li>
      ))}
    </ol>
  );
}

function FloorSim({ run }: { run: FloorRun }) {
  const [box, W] = useWidth<HTMLDivElement>();
  const svg = useRef<SVGSVGElement>(null);
  const [floor, setFloor] = useState(run.ran);
  const [lastRun, setLastRun] = useState(run.run);
  if (lastRun !== run.run) {
    setLastRun(run.run);
    setFloor(run.ran);
  }
  const H = 110;
  const lo = Math.floor(Math.min(...run.items.map((i) => i.best), run.ran) * 20) / 20;
  const hi = Math.ceil(Math.max(...run.items.map((i) => i.best)) * 20) / 20;
  const x = scaleLinear()
    .domain([lo, hi])
    .range([16, W - 16]);
  const sim = simulateFloor(run.items, floor);
  const sorted = [...run.items].sort((a, b) => a.best - b.best);
  const set = (clientX: number) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return;
    const v = x.invert(((clientX - box.left) / box.width) * W);
    setFloor(Math.round(Math.min(hi, Math.max(run.ran, v)) * 1000) / 1000);
  };
  return (
    <div ref={box}>
      <svg
        ref={svg}
        viewBox={`0 0 ${String(W)} ${String(H)}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label="Best similarity of each dev-long item, with the abstention floor"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          set(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) set(e.clientX);
        }}
      >
        <rect x={16} y={10} width={Math.max(0, x(run.ran) - 16)} height={66} fill="var(--muted)" />
        {sorted.map((it, i) => {
          const abst = it.category === 'abstention';
          const below = it.best < floor;
          return (
            <circle
              key={it.id}
              cx={x(it.best)}
              cy={abst ? 26 + (i % 2) * 8 : 54 + (i % 3) * 7}
              r={4}
              fill={abst ? 'var(--record)' : below ? 'var(--danger)' : 'var(--valid)'}
              opacity={below && !abst ? 1 : 0.85}
            >
              <title>{`${it.id} (${it.category}) best ${it.best.toFixed(3)}`}</title>
            </circle>
          );
        })}
        <line
          x1={x(floor)}
          x2={x(floor)}
          y1={6}
          y2={80}
          stroke="var(--accent)"
          strokeWidth={2}
          className="cursor-ew-resize"
        />
        <text x={18} y={22} className="fill-record text-[10px]">
          abstention items
        </text>
        <text x={18} y={74} className="fill-valid text-[10px]">
          answerable items
        </text>
        {x.ticks(Math.max(3, Math.floor(W / 90))).map((v) => (
          <text
            key={v}
            x={x(v)}
            y={98}
            textAnchor="middle"
            className="fill-muted-foreground font-mono text-[10px]"
          >
            {v.toFixed(2)}
          </text>
        ))}
      </svg>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        {[
          ['floor', floor.toFixed(3)],
          ['accuracy', `${String(sim.correct)}/${String(sim.n)}`],
          ['wrongly abstained', String(sim.wronglyAbstained)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-muted/50 p-2">
            <p className="font-mono text-[10px] text-muted-foreground">{k}</p>
            <p className="text-lg font-semibold tabular-nums">{v}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {run.items.length} dev-long items from run <code className="font-mono">{run.run}</code>, at
        their real best similarity. Below the run’s own floor ({run.ran}, shaded) the simulation
        isn’t valid, so the line stops there. Every abstention item is answered correctly at any
        floor: the composer abstains when the memories don’t answer, so the floor is only a safety
        net.
      </p>
    </div>
  );
}

export function Recall() {
  const [qi, setQi] = useState(0);
  const [k, setK] = useState(60);
  const [ranker, setRanker] = useState<'rrf' | 'linear'>('rrf');
  const [priors, setPriors] = useState(true);
  const [hover, setHover] = useState<string | null>(null);
  const [space, setSpace] = useState(RECALL.floors[0]?.space ?? '');
  const trace = RECALL.traces[qi];
  const run = RECALL.floors.find((f) => f.space === space);
  if (!trace) return null;
  return (
    <div>
      <p className="max-w-3xl text-muted-foreground">
        A question runs four searches under the same bitemporal filter: fact vectors, episode
        vectors, Postgres full text, and a one-hop walk from the entities the top hits mention.
        Their ranked lists are fused with reciprocal rank fusion, where each list adds 1 / (k +
        rank) <Cite k="cormack2009" />, and then nudged by mild recency and importance priors. On
        dev-long, RRF and a min-max weighted-linear ranker tied at recall@8 35/36; RRF won because
        it has no weights to tune and needs no score calibration between lists (ADR-010). Generative
        Agents instead sum recency, importance and relevance scores
        <Cite k="park2023" />; Engram keeps those signals for decay and uses ranks for retrieval.
        LongMemEval’s indexing / retrieval / reading split frames what this step must get right
        <Cite k="wu2024" />.
      </p>
      <p className="mt-3 max-w-3xl text-muted-foreground">
        These are real traces: recall run with{' '}
        <code className="font-mono text-sm">trace: true</code> on a history of {RECALL.turns} turns,
        embedded with {RECALL.space}. The slider re-ranks with the same arithmetic as the engine (a
        test proves the scores equal).
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {RECALL.traces.map((t, i) => (
          <button
            key={t.query}
            onClick={() => {
              setQi(i);
            }}
            className={cn(
              'rounded-md border px-2.5 py-1 text-xs',
              qi === i ? 'border-accent bg-accent/10' : 'text-muted-foreground',
            )}
          >
            “{t.query}”
          </button>
        ))}
      </div>

      <div className="mt-4">
        <Lists trace={trace} hover={hover} setHover={setHover} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_18rem]">
        <div className="rounded-lg border bg-card p-3">
          <p className="px-2 font-mono text-[11px] text-muted-foreground">
            fused · top {RECALL.k} go to the composer · {trace.candidates.length} candidates
          </p>
          <div className="mt-2">
            <Fused
              trace={trace}
              ranker={ranker}
              k={k}
              priors={priors}
              hover={hover}
              setHover={setHover}
            />
          </div>
        </div>
        <div className="space-y-3">
          <div className="rounded-lg border bg-card p-3 text-xs">
            <div className="flex gap-1">
              {(['rrf', 'linear'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => {
                    setRanker(r);
                  }}
                  className={cn(
                    'flex-1 rounded-md border px-2 py-1 font-mono',
                    ranker === r ? 'border-accent bg-accent/10' : 'text-muted-foreground',
                  )}
                >
                  {r === 'rrf' ? 'RRF (default)' : 'min-max linear'}
                </button>
              ))}
            </div>
            <label
              className={cn('mt-3 block', ranker !== 'rrf' && 'pointer-events-none opacity-40')}
            >
              <span className="flex justify-between text-muted-foreground">
                RRF k <span className="font-mono text-foreground">{k}</span>
              </span>
              <input
                type="range"
                min={1}
                max={250}
                value={k}
                onChange={(e) => {
                  setK(Number(e.target.value));
                }}
                className="mt-1 w-full accent-[var(--accent)]"
                aria-label="RRF k"
              />
              <span className="flex justify-between font-mono text-[10px] text-muted-foreground">
                <span>1: top ranks dominate</span>
                <button
                  onClick={() => {
                    setK(60);
                  }}
                  className="underline"
                >
                  60
                </button>
                <span>250: a vote count</span>
              </span>
            </label>
            <label
              className={cn(
                'mt-3 flex items-center gap-2',
                ranker !== 'rrf' && 'pointer-events-none opacity-40',
              )}
            >
              <input
                type="checkbox"
                checked={priors}
                onChange={(e) => {
                  setPriors(e.target.checked);
                }}
                className="accent-[var(--accent)]"
              />
              recency and importance priors (×(1 + 0.1·r + 0.1·i))
            </label>
          </div>
          <div className="rounded-lg border bg-card p-3 text-xs">
            <p className="font-mono text-[11px] text-muted-foreground">abstention floor</p>
            <p className="mt-1">
              best similarity{' '}
              <span className="font-mono text-foreground">{trace.bestSimilarity.toFixed(3)}</span>{' '}
              vs floor <span className="font-mono text-accent">{trace.floor}</span>:{' '}
              {trace.abstained ? 'abstained' : 'memories returned'}
            </p>
            <div className="mt-2 h-1.5 rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-valid transition-[width] duration-300"
                style={{ width: `${String(trace.bestSimilarity * 100)}%` }}
              />
            </div>
          </div>
          <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">What these traces show, honestly</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-4">
              <li>
                The graph list re-finds facts the vector list already ranked, so a fact usually
                earns two votes and an episode one. A literal-valued fact (“allergic to penicillin”)
                has no entity to walk to and misses the second vote.
              </li>
              <li>
                Near-ties are broken by the recency prior: the newest fact (“likes ramen”) rises in
                unrelated queries. All right answers are still in the top {RECALL.k}, which is what
                the composer sees and recall@8 measures.
              </li>
              <li>
                “quantum chromodynamics lattice” clears the 0.5 floor (best 0.564): Gemini scores
                unrelated text around 0.5. Abstaining is left to the composer, as on dev-long below.
              </li>
            </ul>
          </div>
        </div>
      </div>

      <h3 className="mt-10 text-lg font-semibold">The floor, simulated on dev-long</h3>
      <div className="mt-3 flex flex-wrap gap-2">
        {RECALL.floors.map((f) => (
          <button
            key={f.space}
            onClick={() => {
              setSpace(f.space);
            }}
            className={cn(
              'rounded-md border px-2.5 py-1 font-mono text-[11px]',
              space === f.space ? 'border-valid bg-valid/10' : 'text-muted-foreground',
            )}
          >
            {f.space}
          </button>
        ))}
      </div>
      <div className="mt-3 rounded-lg border bg-card p-4">{run && <FloorSim run={run} />}</div>
    </div>
  );
}
