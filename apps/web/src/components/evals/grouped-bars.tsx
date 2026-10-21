'use client';

import { scaleBand, scaleLinear } from 'd3';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { MODE_STYLE } from '@/lib/modes';

export interface Group {
  key: string;
  label: string;
  /** mode → value in 0..1 (null: the mode didn't run on this group). */
  values: Record<string, number | null>;
  n?: number;
}

/** Grouped bars (one group per category, one bar per mode), values 0..1. */
export function GroupedBars({
  groups,
  modes,
  height = 260,
}: {
  groups: Group[];
  modes: string[];
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const still = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setWidth(Math.max(300, e.contentRect.width));
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);
  // Narrow screens rotate the category labels so they don't collide.
  const narrow = width < 560;
  const m = { top: 12, right: 8, bottom: narrow ? 78 : 40, left: 34 };
  const x = scaleBand()
    .domain(groups.map((g) => g.key))
    .range([m.left, width - m.right])
    .paddingInner(0.22);
  const inner = scaleBand().domain(modes).range([0, x.bandwidth()]).padding(0.12);
  const y = scaleLinear()
    .domain([0, 1])
    .range([height - m.bottom, m.top]);
  return (
    <div ref={ref} className="w-full">
      <svg width={width} height={height} role="img" aria-label="Accuracy by category and mode">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line
              x1={m.left}
              x2={width - m.right}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--border)"
              strokeDasharray={t === 0 ? undefined : '2 4'}
            />
            <text
              x={m.left - 6}
              y={y(t) + 3}
              textAnchor="end"
              className="fill-muted-foreground font-mono text-[10px]"
            >
              {Math.round(t * 100)}
            </text>
          </g>
        ))}
        {groups.map((g, gi) => (
          <g key={g.key} transform={`translate(${String(x(g.key) ?? 0)},0)`}>
            {modes.map((mode) => {
              const v = g.values[mode];
              if (v === null || v === undefined) return null;
              const h = y(0) - y(v);
              return (
                <motion.rect
                  key={mode}
                  x={inner(mode)}
                  y={y(v)}
                  width={inner.bandwidth()}
                  height={Math.max(1, h)}
                  rx={2}
                  fill={MODE_STYLE[mode]?.color ?? 'var(--foreground)'}
                  style={{ originY: 1, transformBox: 'fill-box' }}
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={
                    still
                      ? { duration: 0 }
                      : { duration: 0.6, delay: gi * 0.05, ease: [0.22, 1, 0.36, 1] }
                  }
                >
                  <title>{`${MODE_STYLE[mode]?.label ?? mode} · ${g.label}: ${String(Math.round(v * 100))}%`}</title>
                </motion.rect>
              );
            })}
            <text
              x={x.bandwidth() / 2}
              y={height - m.bottom + 16}
              textAnchor={narrow ? 'end' : 'middle'}
              transform={
                narrow
                  ? `rotate(-38 ${String(x.bandwidth() / 2)} ${String(height - m.bottom + 16)})`
                  : undefined
              }
              className="fill-foreground text-[11px]"
            >
              {g.label}
            </text>
            {g.n !== undefined && !narrow && (
              <text
                x={x.bandwidth() / 2}
                y={height - m.bottom + 29}
                textAnchor="middle"
                className="fill-muted-foreground font-mono text-[10px]"
              >
                n={g.n}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
