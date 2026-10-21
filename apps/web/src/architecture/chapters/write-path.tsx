'use client';

import { motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import raw from '@/content/generated/writepath.json';
import { formatMoment } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Cite } from '../cite';

/** A time hint as the extraction contract defines it (SPEC §6.1). */
interface Hint {
  kind: string;
  date?: string | null;
  amount?: number | null;
  unit?: string | null;
  direction?: string | null;
  year?: number | null;
  month?: number | null;
  season?: string | null;
}
interface Disambiguation {
  mention: { name: string; description: string };
  candidates: { description: string }[];
  choice: string | null;
  reason: string;
}
interface Candidate {
  subject: { name: string; type: string; description: string | null };
  predicate: string;
  object: { kind: 'entity'; entity: { name: string } } | { kind: 'literal'; value: string };
  statement: string;
  validFrom: Hint;
  validTo: Hint;
  isCorrection: boolean;
  confidence: number;
}
interface Call {
  method: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}
interface Fixture {
  id: string;
  covers: string;
  model: string;
  episodes: { sessionId: string; role: string; content: string; occurredAt: string }[];
  calls: Call[];
  expected: {
    summaries: {
      status: string;
      importance: number | null;
      extracted: number;
      createdEntities: number;
      outcomes: Record<string, number>;
    }[];
    revisions: string[];
    facts: {
      fact: string;
      status: string;
      statement: string;
      validFrom: string;
      validTo: string | null;
    }[];
  };
}
const FIXTURES = raw as unknown as Fixture[];

/** Each episode's calls: its extraction, plus any disambiguation that followed it. */
function callsFor(f: Fixture, i: number): Call[] {
  const out: Call[][] = f.episodes.map(() => []);
  let cur = -1;
  for (const c of f.calls) {
    if (c.method === 'processEpisode')
      cur = f.episodes.findIndex((e, k) => k > cur && e.content === c.input.content);
    if (cur >= 0) out[cur]?.push(c);
  }
  return out[i] ?? [];
}

const hint = (h: Hint) =>
  h.kind === 'none'
    ? '—'
    : h.kind === 'absolute'
      ? (h.date ?? '?')
      : h.kind === 'relative'
        ? `${String(h.amount ?? '?')} ${h.unit ?? ''} ${h.direction ?? ''}`.trim()
        : [h.season, h.month ? `month ${String(h.month)}` : null, h.year ? String(h.year) : null]
            .filter(Boolean)
            .join(' ');

const objectOf = (c: Candidate) =>
  c.object.kind === 'entity' ? c.object.entity.name : `“${c.object.value}”`;

function Step({
  n,
  title,
  children,
  i,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
  i: number;
}) {
  const still = useReducedMotion();
  return (
    <motion.li
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        still ? { duration: 0 } : { duration: 0.35, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] }
      }
      className="relative pl-10"
    >
      <span className="absolute top-0 left-0 flex size-7 items-center justify-center rounded-full border bg-card font-mono text-xs text-accent">
        {n}
      </span>
      <p className="pt-1 font-medium">{title}</p>
      <div className="mt-2 text-sm">{children}</div>
    </motion.li>
  );
}

export function WritePath() {
  const [fid, setFid] = useState('04-correction');
  const [turn, setTurn] = useState(1);
  const [raw, setRaw] = useState(false);
  const f = FIXTURES.find((x) => x.id === fid) ?? FIXTURES[0];
  if (!f) return null;
  const t = Math.min(turn, f.episodes.length - 1);
  const ep = f.episodes[t];
  const calls = callsFor(f, t);
  const extraction = calls.find((c) => c.method === 'processEpisode');
  const disamb = calls
    .filter((c) => c.method === 'disambiguate')
    .map((c) => ({
      ...(c.input as Pick<Disambiguation, 'mention' | 'candidates'>),
      ...(c.output as Pick<Disambiguation, 'choice' | 'reason'>),
    }));
  const summary = f.expected.summaries[t];
  const cands = (extraction?.output.candidates as Candidate[] | undefined) ?? [];
  const outcomes = Object.entries(summary?.outcomes ?? {}).filter(([, v]) => v > 0);
  const last = t === f.episodes.length - 1;

  return (
    <div>
      <p className="max-w-3xl text-muted-foreground">
        One turn’s journey, exactly as recorded: these are the golden fixtures, real Gemini replies
        replayed by the test suite. A single validated call does the understanding (importance plus
        fact candidates, like Generative Agents’ importance scores
        <Cite k="park2023" />
        ); everything after it is deterministic code, with a model consulted only when a rule can’t
        decide. That split, an extract-and-update layer with its machinery exposed, is the
        difference from Mem0
        <Cite k="chhikara2025" />.
      </p>

      <div className="mt-6 flex flex-wrap gap-1.5">
        {FIXTURES.map((x) => (
          <button
            key={x.id}
            onClick={() => {
              setFid(x.id);
              setTurn(x.episodes.length - 1);
            }}
            className={cn(
              'rounded-md border px-2 py-1 font-mono text-[11px] transition-colors',
              fid === x.id
                ? 'border-accent bg-accent/10 text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            title={x.covers}
          >
            {x.id}
          </button>
        ))}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        <span className="font-mono text-xs">{f.id}</span> · {f.covers}
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-[280px_1fr]">
        <ol className="space-y-2" aria-label="Turns">
          {f.episodes.map((e, i) => (
            <li key={i}>
              <button
                onClick={() => {
                  setTurn(i);
                }}
                className={cn(
                  'w-full rounded-lg border p-3 text-left text-sm transition-colors',
                  i === t ? 'border-accent bg-accent/5' : 'bg-card hover:bg-muted/40',
                )}
              >
                <span className="font-mono text-[11px] text-muted-foreground">
                  {e.role} · {e.occurredAt.slice(0, 10)}
                </span>
                <span className="mt-1 block">{e.content}</span>
              </button>
            </li>
          ))}
        </ol>

        <ol key={`${fid}-${String(t)}`} className="space-y-6 rounded-lg border bg-card p-5">
          <Step n={1} title="Stored as an episode, and embedded" i={0}>
            <p className="text-muted-foreground">
              Verbatim, with who said it and when ({ep ? formatMoment(new Date(ep.occurredAt)) : ''}
              ). It is recallable immediately, before extraction runs.
            </p>
          </Step>
          <Step
            n={2}
            title={extraction ? `Extracted by ${f.model}` : 'Not sent to the model'}
            i={1}
          >
            {extraction ? (
              <>
                <p className="text-muted-foreground">
                  importance{' '}
                  <span className="font-mono text-foreground">
                    {String(extraction.output.importance)}
                  </span>{' '}
                  · {cands.length} candidate{cands.length === 1 ? '' : 's'}
                </p>
                {cands.length > 0 && (
                  <div className="mt-2 overflow-x-auto rounded-md border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 font-mono text-[10px] text-muted-foreground">
                        <tr>
                          <th className="px-2 py-1.5 text-left font-normal">subject</th>
                          <th className="px-2 py-1.5 text-left font-normal">predicate</th>
                          <th className="px-2 py-1.5 text-left font-normal">object</th>
                          <th className="px-2 py-1.5 text-left font-normal">from · to (hint)</th>
                          <th className="px-2 py-1.5 text-left font-normal">flags</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cands.map((c, i) => (
                          <tr key={i} className="border-t">
                            <td className="px-2 py-1.5">{c.subject.name}</td>
                            <td className="px-2 py-1.5 font-mono">{c.predicate}</td>
                            <td className="px-2 py-1.5">{objectOf(c)}</td>
                            <td className="px-2 py-1.5 font-mono text-valid">
                              {hint(c.validFrom)} · {hint(c.validTo)}
                            </td>
                            <td className="px-2 py-1.5 font-mono text-[10px]">
                              {c.isCorrection && <span className="text-record">correction </span>}
                              conf {c.confidence}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <button
                  onClick={() => {
                    setRaw(!raw);
                  }}
                  className="mt-2 font-mono text-[11px] text-muted-foreground hover:text-foreground"
                >
                  {raw ? 'hide' : 'show'} the validated reply
                </button>
                {raw && (
                  <pre className="mt-2 max-h-72 overflow-auto rounded-md border bg-background p-3 font-mono text-[11px] leading-relaxed">
                    {JSON.stringify(extraction.output, null, 2)}
                  </pre>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">
                Tool output is stored but never extracted (SPEC §6.1).
              </p>
            )}
          </Step>
          <Step n={3} title="Entities resolved" i={2}>
            <p className="text-muted-foreground">
              Name, then alias, then embedding similarity, then a model call only if candidates
              remain ambiguous.{' '}
              {summary
                ? `${String(summary.createdEntities)} new entit${summary.createdEntities === 1 ? 'y' : 'ies'} this turn.`
                : ''}
            </p>
            {disamb.map((d, i) => (
              <div
                key={i}
                className="mt-2 rounded-md border border-record/40 bg-record/5 p-3 text-xs"
              >
                <p className="font-mono text-[10px] text-record">disambiguation call</p>
                <p className="mt-1">
                  Mention: <strong>{d.mention.name}</strong>, “{d.mention.description}”. Candidate:{' '}
                  {d.candidates.map((c) => `“${c.description}”`).join(', ')}.
                </p>
                <p className="mt-1">
                  Decision: {d.choice === null ? 'a new entity' : `existing ${d.choice}`}.{' '}
                  <span className="text-muted-foreground">{d.reason}</span>
                </p>
              </div>
            ))}
          </Step>
          <Step n={4} title="Conflicts decided" i={3}>
            {outcomes.length > 0 ? (
              <p>
                {outcomes.map(([k, v]) => (
                  <span
                    key={k}
                    className="mr-2 inline-block rounded bg-muted px-2 py-0.5 font-mono text-xs"
                  >
                    {k} × {v}
                  </span>
                ))}
              </p>
            ) : (
              <p className="text-muted-foreground">Nothing to decide this turn.</p>
            )}
            {last && f.expected.revisions.length > 0 && (
              <ul className="mt-2 space-y-1 font-mono text-[11px] text-muted-foreground">
                {f.expected.revisions.map((r, i) => (
                  <li key={i}>revision: {r}</li>
                ))}
              </ul>
            )}
          </Step>
          <Step
            n={5}
            title={
              last
                ? 'Facts held after the conversation'
                : 'Facts after this conversation (go to the last turn)'
            }
            i={4}
          >
            <ul className="space-y-1">
              {f.expected.facts.map((x, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                  <span
                    className={cn(x.status !== 'active' && 'text-muted-foreground line-through')}
                  >
                    {x.statement}
                  </span>
                  <span className="font-mono text-[10px] text-valid">
                    {x.validFrom} → {x.validTo ?? 'now'}
                  </span>
                  {x.status !== 'active' && (
                    <span className="font-mono text-[10px] text-record">{x.status}</span>
                  )}
                </li>
              ))}
            </ul>
          </Step>
        </ol>
      </div>
    </div>
  );
}
