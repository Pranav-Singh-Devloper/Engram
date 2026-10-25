'use client';

import { motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { EngramMark } from './brand/mark';
import { ThemeToggle } from './theme-toggle';

const LINKS = [
  { href: '/chat', label: 'Chat' },
  { href: '/memories', label: 'Memories' },
  { href: '/evals', label: 'Evals' },
  { href: '/architecture', label: 'Architecture' },
] as const;

const GITHUB = 'https://github.com/Pranav-Singh-Devloper/Engram';

/**
 * A floating, rounded glass bar. A highlight slides to whichever link is
 * hovered (or the current page), and the bar tightens once the page scrolls.
 */
export function Nav() {
  const path = usePathname();
  const still = useReducedMotion();
  const [hover, setHover] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 16);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
    };
  }, []);
  const active = LINKS.find((l) => path.startsWith(l.href))?.href ?? null;
  const lit = hover ?? active;
  return (
    <>
      {/* Keeps the page's layout where it was when the bar was in the flow. */}
      <div aria-hidden className="h-20" />
      <header className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-3">
        <nav
          className={cn(
            'pointer-events-auto flex w-full max-w-4xl items-center gap-1 rounded-full border px-2 py-1.5 backdrop-blur-xl backdrop-saturate-150 transition-[transform,box-shadow,background-color] duration-300',
            'border-[color-mix(in_oklch,var(--foreground)_10%,transparent)] bg-[color-mix(in_oklch,var(--background)_62%,transparent)]',
            scrolled
              ? 'scale-[0.985] shadow-[0_8px_40px_-12px_color-mix(in_oklch,var(--accent)_45%,transparent)]'
              : 'shadow-[0_2px_20px_-8px_rgb(0_0_0/0.35)]',
          )}
        >
          <Link
            href="/"
            className="mr-1 flex shrink-0 items-center gap-2 rounded-full py-1 pr-3 pl-2 font-semibold tracking-tight"
          >
            <EngramMark className="h-5 w-auto" title="" />
            Engram
          </Link>
          {/* The links scroll sideways on narrow screens; the actions stay put. */}
          <div
            className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto scrollbar-none"
            onMouseLeave={() => {
              setHover(null);
            }}
          >
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onMouseEnter={() => {
                  setHover(l.href);
                }}
                className={cn(
                  'relative shrink-0 rounded-full px-3 py-1.5 text-sm transition-colors',
                  active === l.href
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {lit === l.href && (
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute inset-0 -z-10 rounded-full bg-[color-mix(in_oklch,var(--foreground)_9%,transparent)]"
                    transition={
                      still ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }
                    }
                  />
                )}
                {l.label}
              </Link>
            ))}
          </div>
          <div className="ml-1 flex shrink-0 items-center gap-1">
            <a
              href={GITHUB}
              aria-label="Engram on GitHub"
              rel="noreferrer"
              className="hidden rounded-full p-2 text-muted-foreground transition-colors hover:text-foreground sm:block"
            >
              <svg viewBox="0 0 16 16" className="size-4" fill="currentColor" aria-hidden>
                <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38v-1.34c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.72 1.22 1.87.87 2.33.67.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.83-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.66 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
            </a>
            <ThemeToggle />
          </div>
        </nav>
      </header>
    </>
  );
}
