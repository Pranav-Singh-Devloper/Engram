// A light that travels around an element's rounded border: a conic gradient,
// rotated by a transform (compositor-only), shown through a 1.5px ring mask.
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function BorderBeam({
  children,
  className,
  duration = 6,
}: {
  children: ReactNode;
  className?: string;
  duration?: number;
}) {
  return (
    <div className={cn('relative isolate overflow-hidden rounded-[inherit] p-[1.5px]', className)}>
      <div
        aria-hidden
        className="absolute top-1/2 left-1/2 -z-10 aspect-square w-[250%] -translate-x-1/2 -translate-y-1/2"
      >
        <div
          className="size-full"
          style={{
            animation: `spin-slow ${String(duration)}s linear infinite`,
            background:
              'conic-gradient(from 0deg, transparent 0 62%, #22d3ee 74%, #8b5cf6 84%, #f59e0b 92%, transparent 100%)',
          }}
        />
      </div>
      <div className="relative rounded-[inherit] bg-background">{children}</div>
    </div>
  );
}
