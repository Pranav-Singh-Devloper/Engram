'use client';

import { motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { EngramMark } from '../brand/mark';

const QUESTIONS = [
  { tone: 'valid', q: 'Where did Sam live last March?', a: 'valid time: when it was true' },
  {
    tone: 'record',
    q: 'What did you know about Sam last March?',
    a: 'record time: when it was believed',
  },
] as const;

export function Hero() {
  const still = useReducedMotion();
  // Always animate to the end state: the server renders the start (opacity 0),
  // so dropping the props under reduced motion would leave the hero invisible.
  // Reduced motion makes the move instant instead.
  const rise = (delay: number) => ({
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: still
      ? { duration: 0 }
      : { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] as const },
  });
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 h-96 bg-[radial-gradient(ellipse_at_center,color-mix(in_oklch,var(--accent)_22%,transparent),transparent_70%)]"
      />
      {/* The mark, large, beside the headline on wide screens. */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-24 right-[max(1rem,calc((100vw-72rem)/2+1rem))] hidden lg:block"
      >
        <div className="absolute inset-0 -z-10 scale-150 rounded-full bg-[radial-gradient(circle,color-mix(in_oklch,var(--accent)_28%,transparent),transparent_65%)] blur-2xl" />
        <EngramMark animated className="h-56 w-auto text-foreground" title="" />
      </div>
      <div className="relative mx-auto max-w-6xl px-4 pt-20 pb-16 sm:pt-28">
        <motion.p {...rise(0)} className="font-mono text-xs tracking-widest text-accent uppercase">
          Persistent memory for AI agents
        </motion.p>
        <motion.h1
          {...rise(0.05)}
          className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl"
        >
          Agents forget between sessions. Engram remembers, and knows when it learned.
        </motion.h1>
        <motion.p
          {...rise(0.12)}
          className="mt-6 max-w-2xl text-lg text-muted-foreground text-pretty"
        >
          It extracts facts from conversations, links them into an entity graph, resolves
          contradictions when facts change, forgets gracefully instead of growing forever, and keeps
          two kinds of time, so it can answer both of these:
        </motion.p>
        <div className="mt-8 grid max-w-3xl gap-3 sm:grid-cols-2">
          {QUESTIONS.map((x, i) => (
            <motion.div
              key={x.q}
              {...rise(0.2 + i * 0.08)}
              className="rounded-lg border bg-card p-4"
            >
              <p className="font-medium">“{x.q}”</p>
              <p
                className={`mt-1 font-mono text-xs ${x.tone === 'valid' ? 'text-valid' : 'text-record'}`}
              >
                {x.a}
              </p>
            </motion.div>
          ))}
        </div>
        <motion.div {...rise(0.36)} className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/chat"
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-transform hover:scale-[1.02] active:scale-[0.98]"
          >
            Try the chat
          </Link>
          <Link
            href="/evals"
            className="rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
          >
            See the benchmarks
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
