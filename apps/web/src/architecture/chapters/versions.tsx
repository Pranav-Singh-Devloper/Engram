'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import casesJson from '@/content/generated/cases.json';
import { formatDay } from '@/lib/format';
import { cn } from '@/lib/utils';
import { STORY } from '../data/bitemporal';
import type { StoryVersion } from '../data/bitemporal';

const REPO = 'https://github.com/Pranav-Singh-Devloper/Engram/blob/main';

/** SPEC §7.4 cases; `test` is null for a case no test claims (the build keeps that visible). */
const cases = casesJson as {
  n: number;
  text: string;
  test: { file: string; line: number; title: string } | null;
}[];

const short = (id: string | null) => (id ? id.slice(0, 4) : '—');

export function Versions() {
  const still = useReducedMotion();
  const [step, setStep] = useState(0);
  const parisAll = STORY.versions.filter((v) => v.object === 'Paris');
  const e = parisAll.find((v) => v.status === 'revised');
  const copy = parisAll.find((v) => v.revises === e?.id);
  const c = STORY.versions.find((v) => v.object === 'Berlin');
  if (!e || !copy || !c) return null;
  const t = copy.recordedAt;

  // What the table shows at each step of the one transaction (SPEC §7.2).
  const rows: { v: StoryVersion; invalidated: Date | null; note: string; fresh: boolean }[] = [
    {
      v: e,
      invalidated: step >= 3 ? e.invalidatedAt : null,
      note: step >= 3 ? 'invalidated: no longer believed from t' : 'the current belief',
      fresh: step === 3,
    },
    ...(step >= 1
      ? [{ v: c, invalidated: null, note: 'inserted: the new value', fresh: step === 1 }]
      : []),
    ...(step >= 2
      ? [
          {
            v: copy,
            invalidated: null,
            note: 'inserted: the old value, closed where the new one starts',
            fresh: step === 2,
          },
        ]
      : []),
  ];
  const STEPS = [
    'Before: one open belief. The user lives in Paris, from 15 Jan 2024, with no end.',
    `“I moved to Berlin in March” arrives on ${formatDay(t)}. Step 1: insert Berlin, valid from 1 Mar 2024.`,
    'Step 2: insert a closed copy of Paris, valid only until Berlin starts. It points back to the original (revises) and forward to Berlin (superseded_by).',
    'Step 3: invalidate the original at the same instant t. Nothing is updated in place except that one timestamp; every belief Engram ever held remains queryable.',
  ];

  return (
    <div>
      <p className="max-w-3xl text-muted-foreground">
        Facts are immutable versions. A change never edits a row; it writes new ones and closes the
        old belief at an instant, all in one transaction. That’s why history queries are exact, and
        why queries filter on the time columns, never on status: status is a label for people, time
        is the truth.
      </p>

      <div className="mt-6 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          {STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => {
                setStep(i);
              }}
              className={cn(
                'rounded-md border px-2.5 py-1 font-mono text-xs',
                step === i ? 'border-accent bg-accent/10' : 'text-muted-foreground',
              )}
            >
              {i === 0 ? 'before' : `step ${String(i)}`}
            </button>
          ))}
          <button
            onClick={() => {
              setStep((s) => (s + 1) % STEPS.length);
            }}
            className="ml-auto rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-foreground"
          >
            {step === STEPS.length - 1 ? 'Replay' : 'Next'}
          </button>
        </div>
        <p className="mt-3 text-sm">{STEPS[step]}</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead className="font-mono text-[10px] text-muted-foreground">
              <tr className="border-b">
                {[
                  'id',
                  'object',
                  'valid_from',
                  'valid_to',
                  'recorded_at',
                  'invalidated_at',
                  'revises',
                  'superseded_by',
                  '',
                ].map((h) => (
                  <th key={h} className="px-2 py-1.5 text-left font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {rows.map(({ v, invalidated, note, fresh }) => (
                  <motion.tr
                    key={v.id}
                    layout={!still}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    transition={
                      still ? { duration: 0 } : { duration: 0.35, ease: [0.22, 1, 0.36, 1] }
                    }
                    className={cn('border-b last:border-0', fresh && 'bg-accent/10')}
                  >
                    <td className="px-2 py-1.5 font-mono">{short(v.id)}</td>
                    <td className="px-2 py-1.5 font-medium">{v.object}</td>
                    <td className="px-2 py-1.5 font-mono text-valid">{formatDay(v.validFrom)}</td>
                    <td className="px-2 py-1.5 font-mono text-valid">
                      {v.validTo ? formatDay(v.validTo) : 'open'}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-record">{formatDay(v.recordedAt)}</td>
                    <td className="px-2 py-1.5 font-mono text-record">
                      {invalidated ? formatDay(invalidated) : '—'}
                    </td>
                    <td className="px-2 py-1.5 font-mono">{short(v.revises)}</td>
                    <td className="px-2 py-1.5 font-mono">
                      {v.id === copy.id ? short(v.supersededBy) : '—'}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">{note}</td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          The closed copy’s recorded_at and the original’s invalidated_at are the same transaction
          timestamp, so at any instant exactly one Paris row is believed: no gap, no overlap (SPEC
          §7.4 case 14).
        </p>
      </div>

      <h3 className="mt-10 text-lg font-semibold">The revision log for this story</h3>
      <div className="mt-2 overflow-x-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 font-mono text-[10px] text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-normal">kind</th>
              <th className="px-3 py-2 text-left font-normal">decided by</th>
              <th className="px-3 py-2 text-left font-normal">reason</th>
              <th className="px-3 py-2 text-left font-normal">at</th>
            </tr>
          </thead>
          <tbody>
            {STORY.revisions.map((r, i) => (
              <tr key={i} className="border-t">
                <td className="px-3 py-2 font-mono">{r.kind}</td>
                <td className="px-3 py-2">{r.resolver}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.reason}</td>
                <td className="px-3 py-2 font-mono text-record">
                  {formatDay(new Date(r.createdAt))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="mt-10 text-lg font-semibold">The 14 cases that must always hold</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        SPEC §7.4, each proven by a test that runs on every commit.
      </p>
      <ol className="mt-3 grid gap-2 md:grid-cols-2">
        {cases.map((k) => (
          <li key={k.n} className="rounded-lg border bg-card p-3 text-sm">
            <span className="font-mono text-xs text-accent">{String(k.n).padStart(2, '0')}</span>{' '}
            {k.text.replace(/`/g, '')}
            {k.test && (
              <a
                href={`${REPO}/${k.test.file}#L${String(k.test.line)}`}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block font-mono text-[11px] text-muted-foreground hover:text-accent"
              >
                {k.test.file.split('/').pop()}:{k.test.line} ↗
              </a>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
