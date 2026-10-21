'use client';

import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { formatDay, formatWindow } from '@/lib/format';
import { believedAt, layoutTimeline, revisionChain, trueAt } from '@/lib/timeline';
import type { Zoom } from '@/lib/timeline';
import { cn } from '@/lib/utils';
import { TimelineChart } from './timeline-chart';

export function EntityTimeline({ id }: { id: string }) {
  const [includeRevised, setIncludeRevised] = useState(false);
  const [zoom, setZoom] = useState<Zoom>('all');
  const q = useQuery({
    queryKey: ['timeline', id, includeRevised],
    queryFn: () => api.timeline(id, includeRevised),
  });
  const now = useMemo(() => new Date(), []);
  const layout = useMemo(
    () => (q.data ? layoutTimeline(q.data.entries, now, zoom) : null),
    [q.data, now, zoom],
  );
  const [known, setKnown] = useState<number | null>(null);
  const [valid, setValid] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  if (q.isPending)
    return <p className="p-8 text-sm text-muted-foreground">Loading the timeline…</p>;
  if (q.isError || !layout) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <p className="p-8 text-sm text-muted-foreground">
        {notFound ? 'No such entity in this namespace.' : 'Could not load the timeline.'}
      </p>
    );
  }
  const { entity, entries } = q.data;
  const [lo, hi] = layout.domain;
  const recorded = entries.map((e) => e.fact.recordedAt.getTime());
  const knownMin = Math.min(...recorded, now.getTime());
  const knownAt = new Date(known ?? now.getTime());
  const validAt = new Date(valid ?? now.getTime());
  const answer = entries.filter((e) => believedAt(e.fact, knownAt) && trueAt(e.fact, validAt));
  const bars = layout.lanes.flatMap((l) => l.bars);
  const chain = selected ? revisionChain(bars, selected) : [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <p className="font-mono text-xs text-muted-foreground">
        {entity.isSelf ? 'the user' : entity.type}
      </p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">
        {entity.isSelf ? 'You' : entity.name}
      </h1>
      {entity.description && <p className="mt-1 text-muted-foreground">{entity.description}</p>}

      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={includeRevised}
            onChange={(e) => {
              setIncludeRevised(e.target.checked);
            }}
            className="accent-[var(--accent)]"
          />
          <History className="size-4 text-record" /> Show record-time history
        </label>
        <span className="font-mono text-xs text-muted-foreground">
          {entries.length} version{entries.length === 1 ? '' : 's'}
        </span>
        <div className="ml-auto inline-flex rounded-lg border p-0.5" role="group" aria-label="Zoom">
          {(['all', '5y', '1y'] as const).map((z) => (
            <button
              key={z}
              type="button"
              aria-pressed={zoom === z}
              onClick={() => {
                setZoom(z);
              }}
              className={cn(
                'rounded-md px-2 py-1 font-mono text-[11px] transition-colors sm:px-2.5 sm:text-xs',
                zoom === z
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {z === 'all' ? 'all time' : z === '5y' ? '5 years' : '1 year'}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border bg-card p-4">
        <TimelineChart
          layout={layout}
          knownAt={knownAt}
          validAt={validAt}
          selected={selected}
          onSelect={setSelected}
        />
      </div>
      <ul
        className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground"
        aria-label="Legend"
      >
        <li className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-6 rounded-sm bg-valid/85" /> believed version
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-6 rounded-sm border border-dashed border-record" />{' '}
          replaced version (record-time history)
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-6 rounded-sm bg-[repeating-linear-gradient(45deg,var(--danger)_0_2px,transparent_2px_6px)]" />{' '}
          retracted
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-6 rounded-sm border-2 border-foreground" /> the
          canonical query's answer
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-6 rounded-sm bg-valid/20" /> not believed at the
          known-at time
        </li>
      </ul>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="block rounded-lg border bg-card p-4">
          <span className="font-mono text-xs text-valid">valid at: {formatDay(validAt)}</span>
          <input
            type="range"
            min={lo.getTime()}
            max={hi.getTime()}
            step={86_400_000}
            value={validAt.getTime()}
            onChange={(e) => {
              setValid(Number(e.target.value));
            }}
            className="mt-2 w-full accent-[var(--valid)]"
            aria-label="Valid at"
          />
          <span className="text-xs text-muted-foreground">When was it true in the world?</span>
        </label>
        <label className="block rounded-lg border bg-card p-4">
          <span className="font-mono text-xs text-record">known at: {formatDay(knownAt)}</span>
          <input
            type="range"
            min={knownMin}
            max={now.getTime()}
            step={3_600_000}
            value={knownAt.getTime()}
            onChange={(e) => {
              setKnown(Number(e.target.value));
            }}
            className="mt-2 w-full accent-[var(--record)]"
            aria-label="Known at"
          />
          <span className="text-xs text-muted-foreground">
            What did Engram believe at that moment?
          </span>
        </label>
      </div>

      <div className="mt-4 rounded-lg border bg-card p-4 text-sm">
        <p className="font-mono text-xs text-muted-foreground">
          canonical query · valid at {formatDay(validAt)} · known at {formatDay(knownAt)}
        </p>
        {answer.length === 0 ? (
          <p className="mt-1 text-muted-foreground">Nothing was believed true then.</p>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {answer.map((e) => (
              <li key={e.fact.id}>{e.fact.statement}</li>
            ))}
          </ul>
        )}
      </div>

      {chain.length > 0 && (
        <div className="mt-4 rounded-lg border bg-card p-4">
          <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Revision chain
          </h2>
          <ol className="mt-2 space-y-2">
            {chain.map((b, i) => (
              <li key={b.id} className="text-sm">
                <span className="font-mono text-xs text-muted-foreground">
                  {i === 0 ? 'selected' : 'revised'}
                </span>{' '}
                {b.statement}{' '}
                <span className="font-mono text-xs text-valid">
                  valid{' '}
                  {formatWindow(
                    b.unknownStart ? new Date(-8.64e15) : b.start,
                    b.open ? null : b.end,
                  )}
                </span>{' '}
                <span className="font-mono text-xs text-record">
                  believed {formatDay(b.recordedAt)} →{' '}
                  {b.invalidatedAt ? formatDay(b.invalidatedAt) : 'now'}
                </span>
              </li>
            ))}
          </ol>
          {chain.length === 1 && !includeRevised && (
            <p className="mt-2 text-xs text-muted-foreground">
              Turn on record-time history to see the versions it replaced.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
