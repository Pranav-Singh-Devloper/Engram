'use client';

import { scaleTime } from 'd3';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDay, formatWindow } from '@/lib/format';
import { believedAt, tickUnit, trueAt } from '@/lib/timeline';
import type { Bar, TimelineLayout } from '@/lib/timeline';
import { cn } from '@/lib/utils';

const ROW_H = 26;
const LANE_GAP = 18;
const AXIS_H = 28;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setWidth(Math.max(260, e.contentRect.width));
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);
  return [ref, width] as const;
}

interface Props {
  layout: TimelineLayout;
  knownAt: Date;
  validAt: Date;
  selected: string | null;
  onSelect: (id: string) => void;
}

export function TimelineChart({ layout, knownAt, validAt, selected, onSelect }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  // Narrow screens give the time axis more room than the predicate names.
  const LABEL_W = width < 520 ? 76 : 112;
  const still = useReducedMotion();
  const [hover, setHover] = useState<{ bar: Bar; x: number; y: number } | null>(null);
  const x = useMemo(
    () =>
      scaleTime()
        .domain(layout.domain)
        .range([LABEL_W, width - 12]),
    [layout.domain, width, LABEL_W],
  );
  const unit = tickUnit(layout.domain);
  const hm = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const dm = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
  const tick = (t: Date) =>
    unit === 'time'
      ? hm.format(t)
      : unit === 'day'
        ? dm.format(t)
        : `${String(t.getUTCFullYear())}${t.getUTCMonth() === 0 ? '' : `-${String(t.getUTCMonth() + 1).padStart(2, '0')}`}`;
  const ticks = x.ticks(Math.max(2, Math.floor(width / 120)));

  let y = AXIS_H;
  const lanes = layout.lanes.map((lane) => {
    const top = y;
    y += lane.rows * ROW_H + LANE_GAP;
    return { lane, top };
  });
  const height = y;

  return (
    <div ref={ref} className="relative w-full">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="Fact timeline: validity bars per predicate"
      >
        <defs>
          <linearGradient id="fade" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="var(--card)" stopOpacity="1" />
            <stop offset="1" stopColor="var(--card)" stopOpacity="0" />
          </linearGradient>
          <pattern
            id="hatch"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--danger)" strokeWidth="2" />
          </pattern>
        </defs>
        {ticks.map((t) => (
          <g key={t.getTime()}>
            <line
              x1={x(t)}
              x2={x(t)}
              y1={AXIS_H - 6}
              y2={height}
              stroke="var(--border)"
              strokeDasharray="2 4"
            />
            <text
              x={x(t)}
              y={14}
              textAnchor="middle"
              className="fill-muted-foreground font-mono text-[10px]"
            >
              {tick(t)}
            </text>
          </g>
        ))}
        {lanes.map(({ lane, top }) => (
          <g key={lane.predicate}>
            <text x={0} y={top + 17} className="fill-foreground font-mono text-[11px]">
              {lane.predicate}
            </text>
            {lane.bars
              .filter((b) => b.end >= layout.domain[0])
              .map((b, i) => {
                const x0 = x(b.start);
                const w = Math.max(3, x(b.end) - x0);
                const yy = top + b.row * ROW_H + 4;
                const believed = believedAt(b, knownAt);
                const isTrue =
                  believed &&
                  trueAt({ validFrom: b.start, validTo: b.open ? null : b.end }, validAt);
                const retracted = b.status === 'retracted';
                return (
                  <motion.g
                    key={b.id}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: believed ? 1 : 0.18, x: 0 }}
                    transition={
                      still
                        ? { duration: 0 }
                        : { duration: 0.45, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }
                    }
                    className="cursor-pointer"
                    onClick={() => {
                      onSelect(b.id);
                    }}
                    onMouseMove={(e) => {
                      const r = ref.current?.getBoundingClientRect();
                      if (r) setHover({ bar: b, x: e.clientX - r.left, y: e.clientY - r.top });
                    }}
                    onMouseLeave={() => {
                      setHover(null);
                    }}
                  >
                    <rect
                      x={x0}
                      y={yy}
                      width={w}
                      height={ROW_H - 8}
                      rx={4}
                      fill={retracted ? 'url(#hatch)' : b.replaced ? 'transparent' : 'var(--valid)'}
                      fillOpacity={b.replaced ? 1 : b.open ? 0.85 : 0.5}
                      stroke={
                        selected === b.id
                          ? 'var(--accent)'
                          : isTrue
                            ? 'var(--foreground)'
                            : b.replaced
                              ? 'var(--record)'
                              : 'none'
                      }
                      strokeWidth={selected === b.id || isTrue ? 2 : 1.25}
                      strokeDasharray={b.replaced ? '4 3' : undefined}
                    />
                    {b.unknownStart && (
                      <rect
                        x={x0}
                        y={yy}
                        width={24}
                        height={ROW_H - 8}
                        fill="url(#fade)"
                        className="pointer-events-none"
                      />
                    )}
                    {w > 44 && (
                      <text
                        x={x0 + 8}
                        y={yy + 13}
                        className={cn(
                          'pointer-events-none text-[11px] font-medium',
                          b.replaced ? 'fill-record' : 'fill-background',
                        )}
                      >
                        {b.unknownStart ? `… ${b.label}` : b.label}
                        {b.open ? ' →' : ''}
                      </text>
                    )}
                  </motion.g>
                );
              })}
          </g>
        ))}
        <line
          x1={x(validAt)}
          x2={x(validAt)}
          y1={AXIS_H - 8}
          y2={height}
          stroke="var(--valid)"
          strokeWidth={1.5}
        />
        {/* Near the right edge the label flips to the line's left, so it never clips. */}
        <text
          x={x(validAt) > width - 60 ? x(validAt) - 4 : x(validAt) + 4}
          y={AXIS_H - 10}
          textAnchor={x(validAt) > width - 60 ? 'end' : 'start'}
          className="fill-valid font-mono text-[10px]"
        >
          valid at
        </text>
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute z-10 w-64 rounded-lg border bg-card p-3 text-xs shadow-xl"
          style={{ left: Math.min(hover.x + 12, width - 270), top: hover.y + 14 }}
        >
          <p className="font-medium">{hover.bar.statement}</p>
          <p className="mt-1.5 font-mono text-valid">
            valid{' '}
            {formatWindow(
              hover.bar.unknownStart ? new Date(-8.64e15) : hover.bar.start,
              hover.bar.open ? null : hover.bar.end,
            )}
          </p>
          <p className="font-mono text-record">
            believed {formatDay(hover.bar.recordedAt)} →{' '}
            {hover.bar.invalidatedAt ? formatDay(hover.bar.invalidatedAt) : 'now'}
          </p>
          <p className="mt-1 text-muted-foreground">
            {hover.bar.status}
            {hover.bar.replaced ? ' · replaced by a later version' : ''}
          </p>
        </div>
      )}
    </div>
  );
}
