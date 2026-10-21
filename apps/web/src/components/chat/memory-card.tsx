import { ArrowUpRight, Brain, MessageSquareText } from 'lucide-react';
import Link from 'next/link';
import { formatWindow } from '@/lib/format';
import type { ChatMemory } from '@/lib/sse-client';
import { cn } from '@/lib/utils';

/** One recalled memory; `used` marks the ones the composer relied on (SPEC §6.3). */
export function MemoryCard({ m, used }: { m: ChatMemory; used: boolean }) {
  const fact = m.kind === 'fact';
  return (
    <li
      className={cn(
        'rounded-lg border bg-card p-3 text-sm transition-colors',
        used
          ? 'border-accent/60 shadow-[0_0_0_1px_color-mix(in_oklch,var(--accent)_35%,transparent)]'
          : 'opacity-70',
      )}
    >
      <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
        {fact ? <Brain className="size-3.5" /> : <MessageSquareText className="size-3.5" />}
        <span>{fact ? 'fact' : m.role === 'assistant' ? 'assistant said' : 'you said'}</span>
        {used && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-accent">used</span>}
        {m.status && m.status !== 'active' && <span className="text-record">{m.status}</span>}
      </div>
      <p className="mt-1.5 leading-snug">{m.text}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px]">
        <span className={fact ? 'text-valid' : 'text-muted-foreground'}>
          {fact
            ? `valid ${formatWindow(m.valid_from, m.valid_to)}`
            : `said ${formatWindow(m.valid_from, null).split(' →')[0] ?? ''}`}
        </span>
        {fact && m.subject_id && (
          <Link
            href={`/entities/${m.subject_id}`}
            className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
          >
            timeline <ArrowUpRight className="size-3" />
          </Link>
        )}
        {m.source_episode_ids.length > 0 && fact && (
          <Link
            href={`/memories?q=${encodeURIComponent(m.text.replace(/^The user /i, '').slice(0, 60))}`}
            className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
          >
            from {m.source_episode_ids.length} turn{m.source_episode_ids.length === 1 ? '' : 's'}{' '}
            <ArrowUpRight className="size-3" />
          </Link>
        )}
      </div>
    </li>
  );
}
