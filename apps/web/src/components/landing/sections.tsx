'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { z } from 'zod';
import { api } from '@/lib/api';
import { pct } from '@/lib/format';
import { BeamFlow } from '../fx/beam-flow';
import { BorderBeam } from '../fx/border-beam';
import { Marquee } from '../fx/marquee';
import { SpotlightCard } from '../fx/spotlight-card';
import { CountUp } from './count-up';

const Stats = z.object({
  scope: z.string(),
  facts: z.object({ total: z.number(), byTier: z.record(z.string(), z.number()) }),
  episodes: z.object({ turns: z.number(), summaries: z.number() }),
  entities: z.number(),
});

async function fetchStats() {
  const res = await fetch('/api/stats', { credentials: 'same-origin' });
  if (!res.ok) return null;
  return Stats.parse(await res.json());
}

/** The showcase memory's size; omitted entirely until a showcase exists (seeded in P10). */
export function LiveStats() {
  const q = useQuery({ queryKey: ['stats'], queryFn: fetchStats });
  const s = q.data;
  if (!s || s.facts.total === 0) return null;
  const cells: [string, number][] = [
    ['facts believed', s.facts.total],
    ['long-term facts', s.facts.byTier.long_term ?? 0],
    ['entities', s.entities],
    ['conversation turns', s.episodes.turns],
  ];
  return (
    <section className="mx-auto max-w-6xl px-4 pb-16">
      <p className="font-mono text-xs text-muted-foreground">
        {s.scope === 'showcase' ? 'in the showcase memory, live' : 'in your demo memory, live'}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cells.map(([label, n]) => (
          <SpotlightCard key={label} className="p-5">
            <dd className="text-4xl font-semibold tracking-tight tabular-nums">
              <CountUp value={n} />
            </dd>
            <dt className="mt-1 text-xs text-muted-foreground">{label}</dt>
          </SpotlightCard>
        ))}
      </dl>
    </section>
  );
}

/** The headline numbers, straight from the committed reports, losses included. */
export function Measured() {
  const q = useQuery({ queryKey: ['evals'], queryFn: api.evals });
  const runs = q.data?.runs ?? [];
  const test = runs.find((r) => r.runId === '2026-10-18-test');
  const lme = runs.find((r) => r.runId === '2026-10-19-longmemeval');
  const kappa = q.data?.agreement?.pooled.kappa;
  if (!test || !lme) return null;
  const acc = (r: typeof test, m: string) => (r.modes[m] ? pct(r.modes[m].accuracy) : '—');
  return (
    <section className="mx-auto max-w-6xl px-4 pb-16">
      <p className="font-mono text-xs tracking-widest text-accent uppercase">Benchmarks</p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight">Measured, not asserted.</h2>
      <div className="mt-6 grid gap-3 md:grid-cols-3">
        <SpotlightCard className="p-5">
          <p className="font-mono text-xs text-muted-foreground">test split · {test.items} items</p>
          <p className="mt-2 text-3xl font-semibold">{acc(test, 'engram')}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Engram, against {acc(test, 'buffer')} for a 20-turn buffer. Rag and full context also
            reach {acc(test, 'rag')}: these histories fit in one prompt.
          </p>
        </SpotlightCard>
        <SpotlightCard className="p-5">
          <p className="font-mono text-xs text-muted-foreground">
            LongMemEval-S · {lme.items} items
          </p>
          <p className="mt-2 text-3xl font-semibold">{acc(lme, 'engram')}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Engram trails rag ({acc(lme, 'rag')}) and full context ({acc(lme, 'full_context')}) on
            ~470-turn histories, using a fraction of full context&apos;s ~48k-token prompts.
            Reported as is.
          </p>
        </SpotlightCard>
        <SpotlightCard className="p-5">
          <p className="font-mono text-xs text-muted-foreground">judge validity</p>
          <p className="mt-2 text-3xl font-semibold">
            κ {kappa === null || kappa === undefined ? '—' : kappa.toFixed(2)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Agreement between the LLM judge and {q.data?.agreement?.pooled.n ?? 0} blind hand
            labels.
          </p>
        </SpotlightCard>
      </div>
      <Link
        href="/evals"
        className="mt-4 inline-flex items-center gap-1 text-sm text-accent hover:underline"
      >
        Every mode, category and cost <ArrowRight className="size-3.5" />
      </Link>
    </section>
  );
}

export function UseIt() {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-24">
      <p className="font-mono text-xs tracking-widest text-accent uppercase">Use it</p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight">Plug it into your agent.</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Engram is an MCP server: six tools (remember, recall, entities, history, forget,
        consolidate) and a stats resource, over stdio for a local install or streamable HTTP for a
        hosted one.
      </p>
      <div className="mt-8 rounded-2xl border bg-card/60 p-4">
        <BeamFlow />
      </div>
      <BorderBeam className="mt-4 rounded-2xl" duration={9}>
        <pre className="overflow-x-auto rounded-2xl bg-card p-5 font-mono text-xs leading-relaxed">
          <code>{`# local (stdio)
claude mcp add engram -e ENGRAM_NAMESPACE=me -- \\
  /path/to/Engram/packages/mcp/node_modules/.bin/tsx /path/to/Engram/packages/mcp/src/stdio.ts

# hosted (HTTP)
claude mcp add --transport http engram https://<your-deploy>/api/mcp \\
  --header "Authorization: Bearer <token>"`}</code>
        </pre>
      </BorderBeam>
    </section>
  );
}

const STACK = [
  'TypeScript',
  'Postgres 17',
  'pgvector · HNSW',
  'Full-text search',
  'Model Context Protocol',
  'Gemini',
  'Ollama',
  'Next.js 16',
  'Vercel',
  'Neon',
  'zod',
  'three.js',
  'GitHub Actions',
];

/** What it's built on, as a slow strip that pauses on hover. */
export function Stack() {
  return (
    <section className="pb-20">
      <Marquee>
        {STACK.map((t) => (
          <span
            key={t}
            className="rounded-full border bg-card/60 px-4 py-1.5 font-mono text-xs whitespace-nowrap text-muted-foreground transition-colors hover:border-accent/60 hover:text-foreground"
          >
            {t}
          </span>
        ))}
      </Marquee>
    </section>
  );
}
