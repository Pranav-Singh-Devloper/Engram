// An endless, edge-faded strip: the items twice over, shifted by half its width
// in a loop (a transform), paused while hovered. Reduced motion stops it.
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Marquee({
  children,
  className,
  seconds = 40,
}: {
  children: ReactNode;
  className?: string;
  seconds?: number;
}) {
  return (
    <div
      className={cn('group/marquee relative overflow-hidden', className)}
      style={{
        maskImage: 'linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)',
      }}
    >
      <div
        className="flex w-max gap-3 group-hover/marquee:[animation-play-state:paused]"
        style={{ animation: `marquee ${String(seconds)}s linear infinite` }}
      >
        <div className="flex shrink-0 gap-3">{children}</div>
        <div className="flex shrink-0 gap-3" aria-hidden>
          {children}
        </div>
      </div>
    </div>
  );
}
