'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The element's content width, kept current. Charts draw at their real pixel
 * width instead of scaling a fixed viewBox, so labels stay legible on a phone.
 */
export function useWidth<T extends HTMLElement>(initial = 760, min = 300) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setWidth(Math.max(min, Math.round(e.contentRect.width)));
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [min]);
  return [ref, width] as const;
}
