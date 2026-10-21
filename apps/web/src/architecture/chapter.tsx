'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * A chapter of /architecture. Its body mounts only when the reader scrolls
 * near it (P09c decision 5: lazy sections), so heavy scenes never load for
 * chapters nobody reaches. The heading is always rendered, so anchors and the
 * table of contents work before the body loads.
 */
export function Chapter({
  id,
  n,
  title,
  kicker,
  children,
  minHeight = 480,
}: {
  id: string;
  n: number;
  title: string;
  kicker: string;
  children: ReactNode;
  minHeight?: number;
}) {
  const ref = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Deep links (#chapter) and print should show the content at once.
    if (location.hash === `#${id}`) setNear(true);
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: '800px 0px' },
    );
    io.observe(el);
    return () => {
      io.disconnect();
    };
  }, [id]);
  return (
    <section
      ref={ref}
      id={id}
      data-chapter
      className="scroll-mt-20 border-t py-16 first:border-t-0"
    >
      <p className="font-mono text-xs tracking-widest text-accent uppercase">
        {String(n).padStart(2, '0')} · {kicker}
      </p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight text-balance">{title}</h2>
      <div className="mt-6" style={near ? undefined : { minHeight }}>
        {near ? children : null}
      </div>
    </section>
  );
}
