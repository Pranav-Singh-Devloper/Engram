'use client';

import { animate, useInView, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

/** Counts up to `value` when scrolled into view; reduced motion shows the number at once. */
export function CountUp({
  value,
  format = (n) => n.toLocaleString('en'),
}: {
  value: number;
  format?: (n: number) => string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const still = useReducedMotion();
  // Starts at 0 on the server and the client alike; the effect sets the value.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!inView) return;
    if (still) {
      setShown(value);
      return;
    }
    const controls = animate(0, value, {
      duration: 1.1,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => {
        setShown(Math.round(v));
      },
    });
    return () => {
      controls.stop();
    };
  }, [inView, still, value]);
  return (
    <span ref={ref} className="tabular-nums">
      {format(shown)}
    </span>
  );
}
