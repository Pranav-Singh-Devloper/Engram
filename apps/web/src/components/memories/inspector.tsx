'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Pin, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Memory, MemoryFilters } from '@/lib/api';
import { ARCHIVE_THRESHOLD, formatDay, formatWindow } from '@/lib/format';
import { cn } from '@/lib/utils';

const PAGE = 50;
const TIERS = ['working', 'long_term', 'archived'] as const;
const STATUSES = ['active', 'superseded', 'retracted', 'revised'] as const;

function filtersFrom(sp: URLSearchParams): MemoryFilters {
  const tier = sp.get('tier');
  return {
    q: sp.get('q') ?? undefined,
    tier: (TIERS as readonly string[]).includes(tier ?? '') ? (tier as Memory['tier']) : undefined,
    status: sp.get('status') ?? undefined,
    predicate: sp.get('predicate') ?? undefined,
    all: sp.get('all') === 'true',
    offset: Number(sp.get('offset') ?? 0) || 0,
  };
}

/** Retention as a meter, with decay's archive threshold marked (SPEC §9). */
function Retention({ value }: { value: number }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div
      className="flex items-center gap-2"
      title={`retention ${v.toFixed(2)} (archived below ${String(ARCHIVE_THRESHOLD)})`}
    >
      <div className="relative h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full', v < ARCHIVE_THRESHOLD ? 'bg-danger' : 'bg-accent')}
          style={{ width: `${String(v * 100)}%` }}
        />
        <div
          className="absolute inset-y-0 w-px bg-foreground/50"
          style={{ left: `${String(ARCHIVE_THRESHOLD * 100)}%` }}
        />
      </div>
      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
        {v.toFixed(2)}
      </span>
    </div>
  );
}

function Row({ m }: { m: Memory }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
        className="grid w-full grid-cols-[1fr_auto] items-start gap-3 px-4 py-3 text-left hover:bg-muted/40 md:grid-cols-[1fr_120px_110px_auto]"
      >
        <span>
          <span className="text-sm">{m.statement}</span>
          <span className="mt-1 flex flex-wrap gap-1.5 font-mono text-[11px] text-muted-foreground">
            <span className="rounded bg-muted px-1.5">{m.predicate}</span>
            <span
              className={cn(
                'rounded px-1.5',
                m.tier === 'long_term' ? 'bg-accent/15 text-accent' : 'bg-muted',
              )}
            >
              {m.tier}
            </span>
            {m.status !== 'active' && (
              <span className="rounded bg-record/15 px-1.5 text-record">{m.status}</span>
            )}
            {m.pinned && <Pin className="size-3" aria-label="pinned" />}
            <span className="text-valid md:hidden">{formatWindow(m.validFrom, m.validTo)}</span>
          </span>
        </span>
        <span className="hidden font-mono text-[11px] text-valid md:block">
          {formatWindow(m.validFrom, m.validTo)}
        </span>
        <span className="hidden md:block">
          <Retention value={m.retention} />
        </span>
        <ChevronDown
          className={cn(
            'mt-0.5 size-4 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <div className="space-y-3 bg-muted/30 px-4 pb-4 text-sm">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 pt-3 font-mono text-[11px] sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">subject</dt>
              <dd>
                <Link
                  href={`/entities/${m.subjectId}`}
                  className="underline decoration-dotted hover:text-accent"
                >
                  {m.subjectName}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">object</dt>
              <dd>
                {m.objectId ? (
                  <Link
                    href={`/entities/${m.objectId}`}
                    className="underline decoration-dotted hover:text-accent"
                  >
                    {m.objectName}
                  </Link>
                ) : (
                  m.objectName
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">believed</dt>
              <dd className="text-record">
                {formatDay(m.recordedAt)} → {m.invalidatedAt ? formatDay(m.invalidatedAt) : 'now'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">importance · access</dt>
              <dd>
                {m.importance.toFixed(2)} · {m.accessScore.toFixed(2)}
              </dd>
            </div>
            <div className="md:hidden">
              <dt className="text-muted-foreground">retention</dt>
              <dd>
                <Retention value={m.retention} />
              </dd>
            </div>
          </dl>
          <div>
            <p className="font-mono text-[11px] text-muted-foreground">
              provenance · {m.sources.length} turn{m.sources.length === 1 ? '' : 's'}
            </p>
            <ul className="mt-1 space-y-1.5">
              {m.sources.map((s) => (
                <li key={s.id} className="rounded-md border bg-card px-3 py-2">
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {s.role} · {formatDay(s.occurredAt)}
                  </span>
                  <p className="mt-0.5">{s.content}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </li>
  );
}

export function Inspector() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filters = filtersFrom(new URLSearchParams(sp.toString()));
  const [q, setQ] = useState(filters.q ?? '');
  useEffect(() => {
    setQ(filters.q ?? '');
  }, [filters.q]);

  const set = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (!('offset' in patch)) next.delete('offset');
    router.replace(`${pathname}${next.size ? `?${next.toString()}` : ''}`, { scroll: false });
  };

  const query = useQuery({
    queryKey: ['memories', filters],
    queryFn: () => api.memories({ ...filters, limit: PAGE }),
    placeholderData: (prev) => prev,
  });
  const data = query.data;
  const offset = filters.offset ?? 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Memories</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Every fact Engram holds, ranked by retention score: how likely it is to survive decay.
        Browsing never counts as using a memory.
      </p>

      <form
        className="mt-6 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: q.trim() || undefined });
        }}
      >
        <label className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
            }}
            placeholder="Search facts"
            aria-label="Search facts"
            className="h-9 w-full rounded-lg border bg-background pr-3 pl-9 text-sm outline-none focus:border-accent"
          />
        </label>
        <select
          aria-label="Tier"
          value={filters.tier ?? ''}
          onChange={(e) => {
            set({ tier: e.target.value || undefined });
          }}
          className="h-9 rounded-lg border bg-background px-2 text-sm"
        >
          <option value="">all tiers</option>
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          aria-label="Status"
          value={filters.status ?? ''}
          onChange={(e) => {
            set({ status: e.target.value || undefined });
          }}
          className="h-9 rounded-lg border bg-background px-2 text-sm"
        >
          <option value="">any status</option>
          {STATUSES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          aria-label="Predicate"
          placeholder="predicate"
          defaultValue={filters.predicate ?? ''}
          onBlur={(e) => {
            set({ predicate: e.target.value.trim() || undefined });
          }}
          className="h-9 w-32 rounded-lg border bg-background px-2 font-mono text-xs"
        />
        <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={filters.all ?? false}
            onChange={(e) => {
              set({ all: e.target.checked ? 'true' : undefined });
            }}
            className="accent-[var(--accent)]"
          />
          include replaced versions
        </label>
      </form>

      <div className="mt-4 overflow-hidden rounded-lg border bg-card">
        <div className="hidden grid-cols-[1fr_120px_110px_auto] gap-3 border-b px-4 py-2 font-mono text-[11px] text-muted-foreground md:grid">
          <span>fact</span>
          <span>valid</span>
          <span>retention ↓</span>
          <span className="w-4" />
        </div>
        {query.isPending ? (
          <p className="p-6 text-sm text-muted-foreground">Loading…</p>
        ) : query.isError ? (
          <p className="p-6 text-sm text-muted-foreground">
            Could not load memories. Start a chat first, or the showcase may not be set up yet.
          </p>
        ) : data && data.memories.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No facts match.</p>
        ) : (
          <ul className={cn(query.isFetching && 'opacity-60 transition-opacity')}>
            {data?.memories.map((m) => (
              <Row key={m.id} m={m} />
            ))}
          </ul>
        )}
      </div>

      {data && data.total > PAGE && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span className="font-mono text-xs">
            {offset + 1}–{Math.min(offset + PAGE, data.total)} of {data.total}
            {data.truncated ? '+' : ''}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => {
                set({ offset: String(Math.max(0, offset - PAGE)) });
              }}
              className="rounded-lg border px-3 py-1 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={offset + PAGE >= data.total}
              onClick={() => {
                set({ offset: String(offset + PAGE) });
              }}
              className="rounded-lg border px-3 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
