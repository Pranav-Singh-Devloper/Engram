'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export interface TocEntry {
  id: string;
  n: number;
  title: string;
}

/** The chapter in view, tracked by scroll position. */
function useActive(entries: TocEntry[]) {
  const [active, setActive] = useState(entries[0]?.id ?? '');
  useEffect(() => {
    const io = new IntersectionObserver(
      (es) => {
        const visible = es
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-15% 0px -70% 0px' },
    );
    for (const el of document.querySelectorAll('[data-chapter]')) io.observe(el);
    return () => {
      io.disconnect();
    };
  }, []);
  return [active, setActive] as const;
}

/** The sticky chapter list beside the page (wide screens). */
export function Toc({ entries }: { entries: TocEntry[] }) {
  const [active] = useActive(entries);
  return (
    <nav
      aria-label="Chapters"
      className="sticky top-20 hidden max-h-[calc(100dvh-6rem)] overflow-y-auto lg:block"
    >
      <ol className="space-y-0.5 border-l text-sm">
        {entries.map((e) => (
          <li key={e.id}>
            <a
              href={`#${e.id}`}
              className={cn(
                '-ml-px block border-l py-1 pl-3 transition-colors',
                active === e.id
                  ? 'border-accent text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="font-mono text-[11px] text-muted-foreground">
                {String(e.n).padStart(2, '0')}
              </span>{' '}
              {e.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** A sticky chapter picker at the top of the content column (narrow screens). */
export function MobileToc({ entries }: { entries: TocEntry[] }) {
  const [active, setActive] = useActive(entries);
  return (
    <label className="sticky top-[4.25rem] z-30 -mx-4 block border-b bg-background/90 px-4 py-2 backdrop-blur lg:hidden">
      <span className="sr-only">Jump to chapter</span>
      <select
        value={active}
        onChange={(e) => {
          location.hash = e.target.value;
          setActive(e.target.value);
        }}
        className="w-full rounded-lg border bg-background px-2 py-1.5 text-sm"
      >
        {entries.map((e) => (
          <option key={e.id} value={e.id}>
            {String(e.n).padStart(2, '0')} · {e.title}
          </option>
        ))}
      </select>
    </label>
  );
}
