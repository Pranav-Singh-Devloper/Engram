'use client';

import { scaleTime } from 'd3';
import { animate, useReducedMotion } from 'motion/react';
import { useMemo, useRef, useState } from 'react';
import { formatDay } from '@/lib/format';
import { believedAt, trueAt } from '@/lib/timeline';
import { cn } from '@/lib/utils';
import { Cite } from '../cite';
import { STORY } from '../data/bitemporal';
import type { StoryVersion } from '../data/bitemporal';

const W = 760;
const H = 420;
const M = { top: 20, right: 20, bottom: 54, left: 150 };

/**
 * A time scale spaced by event: each consecutive pair of distinct moments gets
 * equal room, so a two-month stay in 2024 is as legible as a three-year one in
 * 2015. Ordering is exact; lengths aren't to scale (the chart says so).
 */
function eventScale(times: number[], range: [number, number]) {
  const ts = [...new Set(times)].sort((a, b) => a - b);
  const step = (range[1] - range[0]) / Math.max(1, ts.length - 1);
  return scaleTime()
    .domain(ts.map((t) => new Date(t)))
    .range(ts.map((_, i) => range[0] + i * step))
    .clamp(true);
}

export function Bitemporal() {
  const preds = [...new Set(STORY.versions.map((v) => v.predicate))].sort();
  const [pred, setPred] = useState(preds[0] ?? 'lives_in');
  const versions = STORY.versions.filter((v) => v.predicate === pred);
  const now = STORY.now;
  const still = useReducedMotion();
  const [point, setPoint] = useState<{ valid: number; known: number }>({
    valid: now.getTime(),
    known: now.getTime(),
  });
  const svg = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState(false);

  const { x, y, validTicks, knownTicks } = useMemo(() => {
    const known = versions.filter((v) => !v.unknownStart).map((v) => v.validFrom.getTime());
    const ends = versions.flatMap((v) => (v.validTo ? [v.validTo.getTime()] : []));
    const earliest = Math.min(...known, ...ends);
    const validTimes = [earliest - 4 * 365 * 86_400_000, ...known, ...ends, now.getTime()];
    const recTimes = [
      ...versions.map((v) => v.recordedAt.getTime()),
      ...versions.flatMap((v) => (v.invalidatedAt ? [v.invalidatedAt.getTime()] : [])),
      now.getTime(),
    ];
    const recLo = Math.min(...recTimes) - 86_400_000 * 7;
    return {
      x: eventScale(validTimes, [M.left, W - M.right]),
      y: eventScale([recLo, ...recTimes], [H - M.bottom, M.top]),
      validTicks: [...new Set([...known, ...ends, now.getTime()])].sort((a, b) => a - b),
      knownTicks: [...new Set(versions.map((v) => v.recordedAt.getTime()))].sort((a, b) => a - b),
    };
  }, [versions, now]);

  const validAt = new Date(point.valid);
  const knownAt = new Date(point.known);
  const hit = (v: StoryVersion) => believedAt(v, knownAt) && trueAt(v, validAt);
  const answer = versions.filter(hit);

  const toPoint = (e: React.PointerEvent) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    const py = ((e.clientY - r.top) / r.height) * H;
    setPoint({ valid: x.invert(px).getTime(), known: y.invert(py).getTime() });
  };
  const glide = (valid: number, known: number) => {
    if (still) {
      setPoint({ valid, known });
      return;
    }
    const from = point;
    animate(0, 1, {
      duration: 0.6,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (k) => {
        setPoint({
          valid: from.valid + (valid - from.valid) * k,
          known: from.known + (known - from.known) * k,
        });
      },
    });
  };
  const said = STORY.turns;
  const questions = STORY.answers.filter((a) => a.predicate === pred);
  const byId = new Map(STORY.versions.map((v) => [v.id, v]));

  return (
    <div>
      <p className="max-w-3xl text-muted-foreground">
        Databases have long separated <em>valid time</em>, when something was true in the world,
        from <em>transaction time</em>, when the system recorded it
        <Cite k="snodgrass1985" />. Engram keeps both for every fact, which is what lets it answer
        “where did I live in March?” and “what did you believe about March, back in May?” as
        different questions. Zep makes the same distinction on a knowledge graph
        <Cite k="rasmussen2025" />. Below is the real history the engine stored for this story, told
        out of order. Each rectangle is one stored version: true across its width, believed across
        its height. Drag the crosshair, or pick a question.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {preds.map((p) => (
          <button
            key={p}
            onClick={() => {
              setPred(p);
              setPoint({ valid: now.getTime(), known: now.getTime() });
            }}
            className={cn(
              'rounded-lg border px-3 py-1.5 font-mono text-xs',
              pred === p ? 'border-accent bg-accent/10' : 'text-muted-foreground',
            )}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_300px]">
        <div className="overflow-x-auto rounded-lg border bg-card p-2">
          <svg
            ref={svg}
            viewBox={`0 0 ${String(W)} ${String(H)}`}
            className={cn(
              'min-w-[620px] touch-none select-none',
              dragging ? 'cursor-grabbing' : 'cursor-crosshair',
            )}
            onPointerDown={(e) => {
              setDragging(true);
              (e.target as Element).setPointerCapture(e.pointerId);
              toPoint(e);
            }}
            onPointerMove={(e) => {
              if (dragging) toPoint(e);
            }}
            onPointerUp={() => {
              setDragging(false);
            }}
            role="img"
            aria-label="Bitemporal plane: valid time across, record time up"
          >
            <defs>
              <linearGradient id="bt-fade" x1="0" x2="1">
                <stop offset="0" stopColor="var(--card)" stopOpacity="1" />
                <stop offset="1" stopColor="var(--card)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {validTicks.map((t) => (
              <g key={`v${String(t)}`}>
                <line
                  x1={x(new Date(t))}
                  x2={x(new Date(t))}
                  y1={M.top}
                  y2={H - M.bottom}
                  stroke="var(--border)"
                  strokeDasharray="2 4"
                />
                <text
                  x={x(new Date(t))}
                  y={H - M.bottom + 16}
                  textAnchor="middle"
                  className="fill-muted-foreground font-mono text-[10px]"
                >
                  {formatDay(new Date(t))}
                </text>
              </g>
            ))}
            {knownTicks.map((t) => {
              const turn = said.find((s) => s.learnedAt.getTime() === t);
              return (
                <g key={`k${String(t)}`}>
                  <line
                    x1={M.left}
                    x2={W - M.right}
                    y1={y(new Date(t))}
                    y2={y(new Date(t))}
                    stroke="var(--border)"
                    strokeDasharray="2 4"
                  />
                  <text
                    x={M.left - 8}
                    y={y(new Date(t)) + 3}
                    textAnchor="end"
                    className="fill-muted-foreground font-mono text-[10px]"
                  >
                    {formatDay(new Date(t))}
                  </text>
                  {turn && (
                    <text
                      x={M.left - 8}
                      y={y(new Date(t)) + 15}
                      textAnchor="end"
                      className="fill-record text-[9px]"
                    >
                      “{turn.content.length > 26 ? `${turn.content.slice(0, 25)}…` : turn.content}”
                    </text>
                  )}
                </g>
              );
            })}
            {versions.map((v) => {
              const x0 = v.unknownStart ? M.left : x(v.validFrom);
              const x1 = v.validTo ? x(v.validTo) : W - M.right;
              const y0 = y(v.recordedAt);
              const y1 = v.invalidatedAt ? y(v.invalidatedAt) : M.top;
              const on = hit(v);
              const retracted = v.status === 'retracted';
              return (
                <g key={v.id}>
                  <rect
                    x={x0}
                    y={y1}
                    width={Math.max(4, x1 - x0)}
                    height={Math.max(4, y0 - y1)}
                    rx={4}
                    fill={retracted ? 'var(--danger)' : 'var(--valid)'}
                    fillOpacity={on ? 0.55 : 0.16}
                    stroke={on ? 'var(--foreground)' : retracted ? 'var(--danger)' : 'var(--valid)'}
                    strokeWidth={on ? 2 : 1}
                    strokeDasharray={v.invalidatedAt ? '5 3' : undefined}
                    style={{ transition: 'fill-opacity 160ms, stroke-width 160ms' }}
                  />
                  {v.unknownStart && (
                    <rect
                      x={x0}
                      y={y1}
                      width={28}
                      height={Math.max(4, y0 - y1)}
                      fill="url(#bt-fade)"
                    />
                  )}
                  <text
                    x={x0 + (v.unknownStart ? 30 : 6)}
                    y={y1 + 14}
                    className="pointer-events-none fill-foreground text-[11px] font-medium"
                  >
                    {v.object}
                    {v.validTo ? '' : ' →'}
                  </text>
                </g>
              );
            })}
            <g
              style={{
                transform: `translate(${String(x(validAt))}px, 0)`,
                transition: dragging ? 'none' : undefined,
              }}
            >
              <line
                x1={0}
                x2={0}
                y1={M.top}
                y2={H - M.bottom}
                stroke="var(--valid)"
                strokeWidth={1.5}
              />
            </g>
            <g style={{ transform: `translate(0, ${String(y(knownAt))}px)` }}>
              <line
                x1={M.left}
                x2={W - M.right}
                y1={0}
                y2={0}
                stroke="var(--record)"
                strokeWidth={1.5}
              />
            </g>
            <circle
              cx={x(validAt)}
              cy={y(knownAt)}
              r={6}
              fill="var(--accent)"
              stroke="var(--background)"
              strokeWidth={2}
            />
            <text
              x={W - M.right}
              y={H - 10}
              textAnchor="end"
              className="fill-muted-foreground text-[10px]"
            >
              valid time → (spaced by event, not to scale)
            </text>
            <text x={12} y={M.top + 4} className="fill-muted-foreground text-[10px]">
              ↑ record time
            </text>
          </svg>
        </div>

        <div className="space-y-3">
          <div className="rounded-lg border bg-card p-4 text-sm">
            <p className="font-mono text-[11px] text-muted-foreground">
              valid at <span className="text-valid">{formatDay(validAt)}</span> · known at{' '}
              <span className="text-record">{formatDay(knownAt)}</span>
            </p>
            {answer.length ? (
              answer.map((v) => (
                <p key={v.id} className="mt-1 font-medium">
                  {v.statement}
                </p>
              ))
            ) : (
              <p className="mt-1 text-muted-foreground">Nothing believed true here.</p>
            )}
          </div>
          <div className="rounded-lg border bg-card p-3">
            <p className="px-1 font-mono text-[11px] text-muted-foreground">
              the story’s questions, answered by the engine
            </p>
            <ul className="mt-1">
              {questions.map((q) => {
                const v = q.validAt ? Date.parse(q.validAt) : now.getTime();
                const k = q.knownAt ? Date.parse(q.knownAt) : now.getTime();
                const engine =
                  q.engine.map((id) => byId.get(id)?.object ?? '?').join(', ') || 'nothing';
                return (
                  <li key={q.ask}>
                    <button
                      onClick={() => {
                        glide(v, k);
                      }}
                      className="w-full rounded-md px-1 py-1.5 text-left text-xs hover:bg-muted/50"
                    >
                      {q.ask} <span className="font-mono text-accent">→ {engine}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
