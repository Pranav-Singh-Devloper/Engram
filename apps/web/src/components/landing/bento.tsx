'use client';

// "How it works" as a bento grid: each card is one subsystem with a small live
// picture of it, and links to its /architecture chapter. Visuals animate when
// scrolled into view (transform and opacity, or a short SVG path draw), and
// show their final state under reduced motion.
import { ArrowUpRight } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { SpotlightCard } from '../fx/spotlight-card';

const ease = [0.22, 1, 0.36, 1] as const;

function useEnter() {
  const still = useReducedMotion();
  return (delay = 0) => ({
    initial: { opacity: 0, x: -14 },
    whileInView: { opacity: 1, x: 0 },
    viewport: { once: true, margin: '-40px' },
    transition: still ? { duration: 0 } : { duration: 0.6, delay, ease },
  });
}

/** Two clocks: versions as bars on a valid-time axis, a crosshair sweeping across. */
function TimeAxes() {
  const still = useReducedMotion();
  const enter = useEnter();
  const rows = [
    { l: '8%', w: '34%', c: 'var(--valid)', o: 0.45, label: 'Paris · closed' },
    { l: '42%', w: '50%', c: 'var(--valid)', o: 0.9, label: 'Berlin →' },
    { l: '2%', w: '22%', c: 'var(--record)', o: 0.7, label: 'Lyon · backfilled' },
  ];
  return (
    <div className="relative mt-5 h-28 rounded-xl border bg-background/40 p-3">
      {rows.map((r, i) => (
        <motion.div
          key={r.label}
          {...enter(0.1 + i * 0.12)}
          className="absolute h-5 rounded-md text-[10px] leading-5 font-medium text-background"
          style={{ left: r.l, width: r.w, top: 14 + i * 30, background: r.c, opacity: r.o }}
        >
          <span className="px-2">{r.label}</span>
        </motion.div>
      ))}
      <div
        className="absolute top-2 bottom-2 w-px bg-foreground/70"
        style={still ? { left: '70%' } : { left: 0, animation: 'sweep 6s ease-in-out infinite' }}
      />
      <style>{`@keyframes sweep { 0%,100% { transform: translateX(40px) } 50% { transform: translateX(min(420px, 60vw)) } }`}</style>
    </div>
  );
}

/** Nothing is overwritten: insert, close a copy, invalidate, one transaction. */
function Versions() {
  const enter = useEnter();
  const steps = [
    { t: 'insert', s: 'Berlin, from March', c: 'text-valid' },
    { t: 'insert', s: 'Paris, closed at March', c: 'text-valid' },
    { t: 'invalidate', s: 'the original Paris row', c: 'text-record' },
  ];
  return (
    <ol className="mt-5 space-y-2">
      {steps.map((s, i) => (
        <motion.li
          key={s.s}
          {...enter(0.1 + i * 0.15)}
          className="flex items-center gap-2 rounded-lg border bg-background/40 px-3 py-2 font-mono text-[11px]"
        >
          <span className={cn('w-20 shrink-0', s.c)}>{s.t}</span>
          <span className="truncate text-muted-foreground">{s.s}</span>
        </motion.li>
      ))}
    </ol>
  );
}

/** Four searches, one ranking. */
function Fusion() {
  const enter = useEnter();
  const lists = [
    ['fact vectors', 'var(--valid)'],
    ['episode vectors', 'var(--record)'],
    ['full text', 'var(--success)'],
    ['entity graph', 'var(--accent)'],
  ] as const;
  return (
    <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
      <div className="space-y-1.5">
        {lists.map(([l, c], i) => (
          <motion.div
            key={l}
            {...enter(0.08 * i)}
            className="flex items-center gap-2 rounded-md border bg-background/40 px-2 py-1 text-[10px]"
          >
            <span className="size-1.5 rounded-full" style={{ background: c }} />
            {l}
          </motion.div>
        ))}
      </div>
      <span className="font-mono text-[10px] text-muted-foreground">RRF →</span>
      <motion.div
        {...enter(0.4)}
        className="rounded-lg border border-accent/50 bg-accent/10 p-2 text-center font-mono text-[10px]"
      >
        top 8 <br />
        <span className="text-muted-foreground">to the composer</span>
      </motion.div>
    </div>
  );
}

/** Forgetting on purpose: the retention curve drawn, with its archive line. */
function DecayCurve() {
  const still = useReducedMotion();
  const d = 'M4 10 C 40 60, 70 78, 120 84 S 200 90, 236 91';
  return (
    <svg viewBox="0 0 240 110" className="mt-4 w-full">
      <line
        x1="4"
        x2="236"
        y1="96"
        y2="96"
        stroke="var(--danger)"
        strokeDasharray="3 4"
        opacity="0.7"
      />
      <text x="236" y="106" textAnchor="end" className="fill-danger font-mono text-[8px]">
        archive at 0.15
      </text>
      <motion.path
        d={d}
        fill="none"
        stroke="var(--record)"
        strokeWidth="2.5"
        strokeLinecap="round"
        initial={{ pathLength: still ? 1 : 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true }}
        transition={still ? { duration: 0 } : { duration: 1.4, ease }}
      />
    </svg>
  );
}

/** Sleeping on it: turns gather into one long-term fact. */
function Consolidate() {
  const still = useReducedMotion();
  return (
    <div className="mt-5 flex items-center gap-3">
      <div className="grid grid-cols-4 gap-1.5">
        {Array.from({ length: 8 }, (_, i) => (
          <motion.span
            key={i}
            className={cn(
              'size-3 rounded-full',
              i % 3 === 0 ? 'bg-muted-foreground/40' : 'bg-valid',
            )}
            initial={{ opacity: 1, scale: 1 }}
            whileInView={
              still ? {} : { opacity: i % 3 === 0 ? 0.25 : 1, scale: i % 3 === 0 ? 0.6 : 1 }
            }
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.3 + i * 0.05 }}
          />
        ))}
      </div>
      <span className="font-mono text-[10px] text-muted-foreground">→</span>
      <div className="rounded-lg border bg-background/40 px-2 py-1.5 font-mono text-[10px]">
        <span className="text-valid">long_term</span> · summary + facts
      </div>
    </div>
  );
}

const TOOLS = ['remember', 'recall', 'history', 'entities', 'forget', 'consolidate'];

function Card({
  title,
  body,
  href,
  glow,
  className,
  children,
}: {
  title: string;
  body: string;
  href: string;
  glow: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <SpotlightCard glow={glow} className={cn('min-h-60 p-5', className)}>
      <Link href={href} className="group flex h-full flex-col">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-medium">{title}</h3>
          <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground" />
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
        <div className="mt-auto">{children}</div>
      </Link>
    </SpotlightCard>
  );
}

export function Bento() {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-20">
      <p className="font-mono text-xs tracking-widest text-accent uppercase">How it works</p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight">
        Six mechanisms, each one measured.
      </h2>
      <div className="mt-8 grid gap-3 md:grid-cols-3">
        <Card
          className="md:col-span-2"
          glow="var(--valid)"
          title="Two clocks on every fact"
          body="Valid time says when it was true; record time says when Engram believed it. Every read is one as-of query over both."
          href="/architecture#bitemporal"
        >
          <TimeAxes />
        </Card>
        <Card
          glow="var(--record)"
          title="Nothing is overwritten"
          body="A change writes new versions and closes the old belief at one instant, in one transaction."
          href="/architecture#versions"
        >
          <Versions />
        </Card>
        <Card
          glow="var(--accent)"
          title="Four searches, one ranking"
          body="Vectors, full text and the entity graph, fused by reciprocal rank, with an abstention floor."
          href="/architecture#recall"
        >
          <Fusion />
        </Card>
        <Card
          glow="var(--record)"
          title="Forgetting on purpose"
          body="Unused facts decay on a forgetting curve and are archived, reversibly. Important ones never are."
          href="/architecture#decay"
        >
          <DecayCurve />
        </Card>
        <Card
          glow="var(--valid)"
          title="Sleeping on it"
          body="Nightly consolidation skips small talk for free and turns sessions into long-term facts."
          href="/architecture#consolidation"
        >
          <Consolidate />
        </Card>
        <Card
          className="min-h-0 md:col-span-3"
          glow="var(--accent)"
          title="Native to MCP"
          body="Six tools and a stats resource, over stdio for local clients or streamable HTTP with a bearer token."
          href="/architecture#interfaces"
        >
          <div className="mt-5 flex flex-wrap gap-2">
            {TOOLS.map((t) => (
              <span
                key={t}
                className="rounded-full border bg-background/40 px-3 py-1 font-mono text-xs transition-transform duration-200 hover:-translate-y-0.5 hover:border-accent/60"
              >
                engram_{t}
              </span>
            ))}
          </div>
        </Card>
      </div>
    </section>
  );
}
