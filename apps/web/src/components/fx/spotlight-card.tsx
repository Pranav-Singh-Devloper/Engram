'use client';

// A card lit by a soft spotlight that follows the cursor, with a matching glow
// on its border. The pointer position goes straight into CSS variables (no
// React state), so moving the mouse never re-renders anything.
import type { ReactNode } from 'react';
import { useRef } from 'react';
import { cn } from '@/lib/utils';

export function SpotlightCard({
  children,
  className,
  glow = 'var(--accent)',
}: {
  children: ReactNode;
  className?: string;
  glow?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      onPointerMove={(e) => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty('--sx', `${String(e.clientX - r.left)}px`);
        el.style.setProperty('--sy', `${String(e.clientY - r.top)}px`);
      }}
      className={cn(
        'group/spot relative overflow-hidden rounded-2xl border bg-card/70 transition-colors duration-300 hover:border-transparent',
        className,
      )}
      style={{ '--glow': glow } as React.CSSProperties}
    >
      {/* The border glow: a spotlight behind a 1px inset, visible only at the edge. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover/spot:opacity-100"
        style={{
          background:
            'radial-gradient(240px circle at var(--sx, 50%) var(--sy, 50%), color-mix(in oklch, var(--glow) 70%, transparent), transparent 70%)',
          WebkitMask: 'linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0)',
          mask: 'linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0)',
          padding: 1,
        }}
      />
      {/* The surface light. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover/spot:opacity-100"
        style={{
          background:
            'radial-gradient(420px circle at var(--sx, 50%) var(--sy, 50%), color-mix(in oklch, var(--glow) 12%, transparent), transparent 65%)',
        }}
      />
      <div className="relative h-full">{children}</div>
    </div>
  );
}
