'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { formatDay } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Cite } from '../cite';
import { CONSOLIDATION, CONSOLIDATION_CONFIG, WEAK_INFERENCES, skips } from '../data/consolidation';

const STAGES = [
  { t: 'unconsolidated turns', d: 'extracted, kind = turn, never tool output' },
  { t: 'cluster', d: 'by session; split on drift < 0.5; ≤ 12 turns' },
  { t: 'budget gate', d: 'all turns below importance 0.3: done, no call' },
  { t: 'summarize', d: 'one LLM call: candidates citing turns t1…tn, plus a summary' },
  { t: 'write path', d: 'the same resolveCandidates as extraction (§6.1)' },
  { t: 'long_term', d: 'created or confirmed facts promoted; the only way in' },
];

function Pipeline() {
  const still = useReducedMotion();
  return (
    <ol className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {STAGES.map((s, i) => (
        <motion.li
          key={s.t}
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={still ? { duration: 0 } : { duration: 0.4, delay: i * 0.07 }}
          className="relative rounded-lg border bg-card p-3"
        >
          <p className="font-mono text-[10px] text-accent">{String(i + 1).padStart(2, '0')}</p>
          <p className="mt-0.5 text-sm font-medium">{s.t}</p>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{s.d}</p>
        </motion.li>
      ))}
    </ol>
  );
}

export function Consolidation() {
  const still = useReducedMotion();
  const { sessions, consolidation, testSplit } = CONSOLIDATION;
  const [min, setMin] = useState(CONSOLIDATION_CONFIG.minImportance);
  const [open, setOpen] = useState<string | null>(sessions.find((s) => s.summary)?.id ?? null);
  const calls = sessions.filter((s) => !skips(s, min)).length;
  const picked = sessions.find((s) => s.id === open);
  const current = picked?.facts.filter((f) => f.current) ?? [];
  const replaced = (picked?.facts.length ?? 0) - current.length;
  const o = testSplit.outcomes;

  return (
    <div>
      <p className="max-w-3xl text-muted-foreground">
        Episodes are what was said and when; facts are what is true
        <Cite k="tulving1972" />. Brains are thought to capture episodes fast and distil them into
        lasting knowledge slowly, offline
        <Cite k="mcclelland1995" />. Engram’s nightly consolidation does the same: it rereads recent
        turns in clusters, summarizes each, and runs the facts it finds back through the write path,
        which confirms what extraction already stored and promotes it to long_term. Generative
        Agents’ reflection plays a similar role
        <Cite k="park2023" />, but writes higher-level observations into the same stream; Engram
        writes versioned facts with provenance.
      </p>

      <div className="mt-6">
        <Pipeline />
      </div>

      <h3 className="mt-10 text-lg font-semibold">One real history, consolidated</h3>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        dev-long item <code className="font-mono">{CONSOLIDATION.item}</code>: 4 sessions about the
        user and 8 filler sessions of general questions, run through{' '}
        <code className="font-mono">engram_consolidated</code> on Gemini exactly as the bench does.
        Bars are the importance the extractor gave each turn. Drag the gate: at the engine’s 0.3 it
        reproduces the run (a test checks it).
      </p>

      <div className="mt-4 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            budget gate (minImportance)
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={min}
              onChange={(e) => {
                setMin(Number(e.target.value));
              }}
              className="w-40 accent-[var(--accent)]"
              aria-label="Minimum importance"
            />
            <span className="font-mono text-foreground">{min.toFixed(2)}</span>
          </label>
          <p className="font-mono text-xs">
            <span className="text-accent">{calls}</span> summarize calls ·{' '}
            <span className="text-muted-foreground">{sessions.length - calls} skipped free</span>
          </p>
        </div>

        <ol className="mt-4 grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-12">
          {sessions.map((s) => {
            const skipped = skips(s, min);
            return (
              <li key={s.id}>
                <button
                  onClick={() => {
                    setOpen(s.id);
                  }}
                  aria-pressed={open === s.id}
                  className={cn(
                    'w-full rounded-md border p-1.5 text-left transition-colors',
                    open === s.id ? 'border-accent' : 'hover:border-foreground/30',
                    skipped && 'opacity-60',
                  )}
                >
                  <span className="flex h-12 items-end gap-0.5">
                    {s.turns.map((t, i) => (
                      <span
                        key={i}
                        className="flex-1 origin-bottom rounded-sm transition-transform duration-300"
                        style={{
                          height: '100%',
                          transform: `scaleY(${String(Math.max(0.04, t.importance))})`,
                          background: s.filler ? 'var(--muted-foreground)' : 'var(--valid)',
                        }}
                      />
                    ))}
                  </span>
                  <span className="mt-1 block truncate font-mono text-[9px] text-muted-foreground">
                    {s.id}
                  </span>
                  <span
                    className={cn(
                      'block font-mono text-[9px]',
                      skipped ? 'text-muted-foreground' : 'text-accent',
                    )}
                  >
                    {skipped ? 'skip' : 'summarize'}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        <AnimatePresence mode="wait">
          {picked && (
            <motion.div
              key={picked.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={still ? { duration: 0 } : { duration: 0.25 }}
              className="mt-4 grid gap-4 border-t pt-4 text-sm lg:grid-cols-2"
            >
              <div>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {picked.id} · {formatDay(new Date(picked.occurredAt))} ·{' '}
                  {picked.filler ? 'filler' : 'about the user'}
                </p>
                <ol className="mt-2 space-y-1.5">
                  {picked.turns.map((t, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        t{i + 1} · {t.importance.toFixed(1)}
                      </span>
                      <span>{t.content}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <div>
                {picked.summary ? (
                  <>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      summary episode (embedded, recallable)
                    </p>
                    <p className="mt-1 rounded-md bg-muted/50 p-2">{picked.summary}</p>
                    <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                      current facts from these turns ({replaced} earlier versions replaced)
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {current.map((f) => (
                        <li key={f.statement} className="flex gap-2">
                          <span
                            className={cn(
                              'rounded px-1 font-mono text-[9px]',
                              f.tier === 'long_term'
                                ? 'bg-valid/15 text-valid'
                                : 'bg-record/15 text-record',
                            )}
                          >
                            {f.tier}
                          </span>
                          {f.statement}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    Every turn scored {picked.maxImportance.toFixed(1)}, below the gate: marked
                    consolidated with no model call. Small talk costs nothing.
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        This run: {consolidation.summarized} clusters summarized, {consolidation.skipped} skipped,{' '}
        {consolidation.outcomes.merged ?? 0} candidates merged with facts extraction already held,{' '}
        {consolidation.outcomes.rejected ?? 0} rejected, {consolidation.longTermFacts} long_term
        facts at the end. Asked “{CONSOLIDATION.question}”, it answered “{CONSOLIDATION.answer}”
      </p>

      <div className="mt-8 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-lg border p-4">
          <h3 className="font-medium">Across the test split ({testSplit.items} items)</h3>
          <dl className="mt-3 grid grid-cols-2 gap-2">
            {[
              ['summarized / item', testSplit.summarizedPerItem],
              ['skipped / item', testSplit.skippedPerItem],
              ['merged', (o.merged ?? 0).toLocaleString('en')],
              ['inserted', o.inserted ?? 0],
            ].map(([k, v]) => (
              <div key={String(k)} className="rounded-lg bg-muted/50 p-2">
                <dt className="font-mono text-[10px] text-muted-foreground">{k}</dt>
                <dd className="text-lg font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-muted-foreground">
            Consolidation mostly confirms: 98.6% of its candidates merge with a fact extraction
            already stored, and a merge from the same turns leaves confidence unchanged
            (provenance-aware merge, §7.2.3). Its value is the promotion to long_term (τ = 90 d) and
            the recallable summaries, not new facts.
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <h3 className="font-medium">What it inserted, shown honestly</h3>
          <ul className="mt-2 space-y-0.5">
            {testSplit.inserted.map((s) => (
              <li
                key={s}
                className={cn(
                  'flex gap-2',
                  WEAK_INFERENCES.includes(s) ? 'text-danger' : 'text-muted-foreground',
                )}
              >
                <span className="font-mono text-[10px]">
                  {WEAK_INFERENCES.includes(s) ? 'weak' : 'ok'}
                </span>
                {s}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            {testSplit.inserted.length} distinct statements. Three are weak inferences: two visits
            that were never stated, and a pet paired with the sister’s city. None appeared in a
            wrong answer (ledger row 28). It’s a documented limitation, not something tuned away on
            test.
          </p>
        </div>
      </div>
    </div>
  );
}
