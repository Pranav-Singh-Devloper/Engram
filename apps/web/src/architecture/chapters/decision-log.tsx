'use client';

import { ChevronDown, Search } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useMemo, useState } from 'react';
import adrsJson from '@/content/generated/adrs.json';
import { cn } from '@/lib/utils';
import { Inline } from '../inline';

type Block =
  | { type: 'p'; text: string }
  | { type: 'list'; ordered: boolean; items: { text: string; level: number }[] }
  | { type: 'table'; header: string[]; rows: string[][] };
interface Adr {
  id: string;
  number: number;
  title: string;
  date: string;
  status: string;
  sections: { label: string; blocks: Block[] }[];
}
const ADRS = adrsJson as Adr[];

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) =>
        b.type === 'p' ? (
          <p key={i} className="mt-2 leading-relaxed">
            <Inline text={b.text} />
          </p>
        ) : b.type === 'list' ? (
          <ul key={i} className="mt-2 space-y-1">
            {b.items.map((it, j) => (
              <li
                key={j}
                className="flex gap-2 leading-relaxed"
                style={{ paddingLeft: `${String(it.level * 1.25)}rem` }}
              >
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent/60" aria-hidden />
                <span>
                  <Inline text={it.text} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div key={i} className="mt-3 overflow-x-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  {b.header.map((h, j) => (
                    <th key={j} className="px-3 py-2 text-left font-medium">
                      <Inline text={h} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j} className="border-t align-top">
                    {r.map((c, k) => (
                      <td key={k} className="px-3 py-2">
                        <Inline text={c} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ),
      )}
    </>
  );
}

const summaryOf = (a: Adr) => {
  const d = a.sections.find((s) => s.label.startsWith('Decision'));
  const first = d?.blocks.find((b) => b.type === 'p');
  const text = first?.type === 'p' ? first.text : '';
  if (text.length <= 220) return text;
  let cut = text.slice(0, 217);
  // Never end inside a code span: an odd number of backticks means one is open.
  if ((cut.match(/`/g) ?? []).length % 2 === 1) cut = cut.slice(0, cut.lastIndexOf('`'));
  return `${cut.trimEnd()}…`;
};

export function DecisionLog() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const still = useReducedMotion();
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return ADRS;
    return ADRS.filter((a) => JSON.stringify(a).toLowerCase().includes(needle));
  }, [q]);
  return (
    <div>
      <p className="max-w-3xl text-muted-foreground">
        Every significant choice is recorded as an architecture decision record in{' '}
        <code className="font-mono text-sm">DECISIONS.md</code>, with its context, the alternatives
        rejected and the evidence. This chapter is generated from that file, so it can’t drift from
        it. {ADRS.length} decisions so far.
      </p>
      <label className="relative mt-6 block max-w-md">
        <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
          }}
          placeholder="Search decisions (e.g. quota, bitemporal, Neon)"
          aria-label="Search decisions"
          className="h-9 w-full rounded-lg border bg-background pr-3 pl-9 text-sm outline-none focus:border-accent"
        />
      </label>
      <ol className="relative mt-6 space-y-3 border-l pl-6">
        <AnimatePresence initial={false}>
          {shown.map((a) => {
            const isOpen = open === a.id;
            return (
              <motion.li
                key={a.id}
                layout={!still}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={still ? { duration: 0 } : { duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="relative"
              >
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-4 -left-[29px] size-2.5 rounded-full border-2 border-background',
                    isOpen ? 'bg-accent' : 'bg-muted-foreground/50',
                  )}
                />
                <div className="rounded-lg border bg-card">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => {
                      setOpen(isOpen ? null : a.id);
                    }}
                    className="flex w-full items-start gap-3 p-4 text-left"
                  >
                    <span className="flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2 font-mono text-[11px] text-muted-foreground">
                        <span className="text-accent">{a.id}</span>
                        <span>{a.date}</span>
                        <span>{a.status}</span>
                      </span>
                      <span className="mt-1 block font-medium">
                        <Inline text={a.title} />
                      </span>
                      {!isOpen && (
                        <span className="mt-1 block text-sm text-muted-foreground">
                          <Inline text={summaryOf(a)} />
                        </span>
                      )}
                    </span>
                    <ChevronDown
                      className={cn(
                        'mt-1 size-4 shrink-0 text-muted-foreground transition-transform',
                        isOpen && 'rotate-180',
                      )}
                    />
                  </button>
                  {isOpen && (
                    <div className="border-t px-4 pb-4 text-sm">
                      {a.sections.map((s) => (
                        <div key={s.label} className="mt-4">
                          <h4 className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
                            {s.label}
                          </h4>
                          <Blocks blocks={s.blocks} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>
      {shown.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">No decision mentions that.</p>
      )}
    </div>
  );
}
