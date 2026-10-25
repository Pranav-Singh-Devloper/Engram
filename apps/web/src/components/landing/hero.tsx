'use client';

import { ArrowRight } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { EngramMark } from '../brand/mark';
import { BorderBeam } from '../fx/border-beam';
import { SpotlightCard } from '../fx/spotlight-card';

const QUESTIONS = [
  { tone: 'valid', q: 'Where did Sam live last March?', a: 'valid time: when it was true' },
  {
    tone: 'record',
    q: 'What did you know about Sam last March?',
    a: 'record time: when it was believed',
  },
] as const;

/** A soft light that trails the cursor across the hero (fine pointers only), moved by transform. */
function CursorLight() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host || !window.matchMedia('(pointer: fine)').matches) return;
    let frame = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = host.getBoundingClientRect();
        el.style.transform = `translate3d(${String(e.clientX - r.left - 300)}px, ${String(e.clientY - r.top - 300)}px, 0)`;
        el.style.opacity = '1';
      });
    };
    const leave = () => {
      el.style.opacity = '0';
    };
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerleave', leave);
    return () => {
      cancelAnimationFrame(frame);
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerleave', leave);
    };
  }, []);
  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute top-0 left-0 size-[600px] rounded-full opacity-0 transition-opacity duration-500"
      style={{
        background:
          'radial-gradient(circle, color-mix(in oklch, var(--accent) 16%, transparent), transparent 60%)',
      }}
    />
  );
}

export function Hero() {
  const still = useReducedMotion();
  // Always animate to the end state: the server renders the start (opacity 0),
  // so dropping the props under reduced motion would leave the hero invisible.
  // Reduced motion makes the move instant instead.
  const rise = (delay: number) => ({
    initial: { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: still
      ? { duration: 0 }
      : { duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] as const },
  });
  return (
    <section className="relative -mt-20 overflow-hidden pt-20">
      {/* Aurora: three slow, blurred lights in the brand's time colours. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute -top-40 left-[8%] size-[520px] rounded-full opacity-30 blur-[110px]"
          style={{ background: 'var(--accent)', animation: 'aurora 18s ease-in-out infinite' }}
        />
        <div
          className="absolute top-10 right-[6%] size-[440px] rounded-full opacity-20 blur-[110px]"
          style={{
            background: 'var(--valid)',
            animation: 'aurora 23s ease-in-out infinite reverse',
          }}
        />
        <div
          className="absolute top-72 left-[38%] size-[360px] rounded-full opacity-[0.12] blur-[110px]"
          style={{ background: 'var(--record)', animation: 'aurora 27s ease-in-out infinite' }}
        />
        <div className="dot-grid absolute inset-0" />
      </div>
      <CursorLight />

      {/* The mark, large and floating, beside the headline on wide screens. */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-36 right-[max(1rem,calc((100vw-72rem)/2+1rem))] hidden lg:block"
      >
        <div className="absolute inset-0 -z-10 scale-150 rounded-full bg-[radial-gradient(circle,color-mix(in_oklch,var(--accent)_30%,transparent),transparent_65%)] blur-2xl" />
        <div style={{ animation: 'float 7s ease-in-out infinite' }}>
          <EngramMark animated className="h-60 w-auto text-foreground" title="" />
        </div>
      </div>

      <div className="relative mx-auto max-w-6xl px-4 pt-16 pb-20 sm:pt-24">
        <motion.p
          {...rise(0)}
          className="inline-flex items-center gap-2 rounded-full border bg-[color-mix(in_oklch,var(--background)_60%,transparent)] px-3 py-1 font-mono text-[11px] tracking-widest text-muted-foreground uppercase backdrop-blur"
        >
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
            <span className="relative inline-flex size-1.5 rounded-full bg-accent" />
          </span>
          Persistent memory for AI agents · over MCP
        </motion.p>
        <motion.h1
          {...rise(0.06)}
          className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl"
        >
          Agents forget between sessions. Engram remembers, and{' '}
          <span className="bg-[linear-gradient(110deg,var(--valid),var(--accent)_55%,var(--record))] bg-clip-text text-transparent">
            knows when it learned.
          </span>
        </motion.h1>
        <motion.p
          {...rise(0.14)}
          className="mt-6 max-w-2xl text-lg text-muted-foreground text-pretty"
        >
          It extracts facts from conversations, links them into an entity graph, resolves
          contradictions when facts change, forgets gracefully instead of growing forever, and keeps
          two kinds of time, so it can answer both of these:
        </motion.p>
        <div className="mt-8 grid max-w-3xl gap-3 sm:grid-cols-2">
          {QUESTIONS.map((x, i) => (
            <motion.div key={x.q} {...rise(0.22 + i * 0.08)}>
              <SpotlightCard
                glow={x.tone === 'valid' ? 'var(--valid)' : 'var(--record)'}
                className="h-full p-4"
              >
                <p className="font-medium">“{x.q}”</p>
                <p
                  className={`mt-1 font-mono text-xs ${x.tone === 'valid' ? 'text-valid' : 'text-record'}`}
                >
                  {x.a}
                </p>
              </SpotlightCard>
            </motion.div>
          ))}
        </div>
        <motion.div {...rise(0.38)} className="mt-10 flex flex-wrap items-center gap-3">
          <BorderBeam className="rounded-full">
            <Link
              href="/chat"
              className="group inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground transition-transform active:scale-[0.98]"
            >
              Try the chat
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </BorderBeam>
          <Link
            href="/architecture"
            className="rounded-full border bg-[color-mix(in_oklch,var(--background)_60%,transparent)] px-5 py-2.5 text-sm font-medium backdrop-blur transition-colors hover:bg-muted"
          >
            Explore the architecture
          </Link>
          <Link
            href="/evals"
            className="px-2 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            See the benchmarks →
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
