'use client';

// The Engram mark (assets/logos/icon.png), redrawn as SVG so it stays crisp at
// any size and follows the theme: the stem takes the text colour, the bars
// keep the brand's three time colours (valid cyan, record amber, accent
// violet), and the dot is the present moment. `animated` draws the bars in
// and lets the dot breathe; reduced motion shows the finished mark at once.
import { motion, useReducedMotion } from 'motion/react';
import { useId } from 'react';
import { cn } from '@/lib/utils';

const BARS = [
  { y: 18, w: 74, fill: '#22d3ee' },
  { y: 43, w: 38, fill: '#f59e0b' },
  { y: 68, w: 60, fill: '#8b5cf6' },
] as const;

export function EngramMark({
  className,
  animated = false,
  title = 'Engram',
}: {
  className?: string;
  animated?: boolean;
  title?: string;
}) {
  const still = useReducedMotion();
  const glow = useId();
  const move = animated && !still;
  return (
    <svg
      viewBox="0 0 112 90"
      className={cn('overflow-visible', className)}
      {...(title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true })}
    >
      <defs>
        <filter id={glow} x="-150%" y="-150%" width="400%" height="400%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect x="2" y="18" width="6" height="66" rx="3" fill="currentColor" />
      {BARS.map((b, i) => (
        <motion.rect
          key={b.y}
          x="9"
          y={b.y}
          width={b.w}
          height="16"
          rx="8"
          fill={b.fill}
          style={{ transformBox: 'fill-box', transformOrigin: 'left center' }}
          initial={{ scaleX: animated ? 0 : 1 }}
          animate={{ scaleX: 1 }}
          transition={
            move
              ? { duration: 0.7, delay: 0.15 + i * 0.14, ease: [0.22, 1, 0.36, 1] }
              : { duration: 0 }
          }
        />
      ))}
      <motion.circle
        cx="96"
        cy="9"
        r="8"
        fill="#8b5cf6"
        filter={`url(#${glow})`}
        initial={{ opacity: animated ? 0 : 1, scale: animated ? 0.4 : 1 }}
        animate={
          move ? { opacity: [0, 1, 0.75, 1], scale: [0.4, 1.15, 1, 1] } : { opacity: 1, scale: 1 }
        }
        transition={
          move ? { duration: 1.2, delay: 0.65, times: [0, 0.4, 0.7, 1] } : { duration: 0 }
        }
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
      />
    </svg>
  );
}
