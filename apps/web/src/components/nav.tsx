'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ThemeToggle } from './theme-toggle';

const LINKS = [
  { href: '/chat', label: 'Chat' },
  { href: '/memories', label: 'Memories' },
  { href: '/evals', label: 'Evals' },
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md">
      <nav className="mx-auto flex h-14 max-w-6xl items-center gap-0.5 px-4 sm:gap-1">
        <Link
          href="/"
          className="mr-2 flex items-center gap-2 font-semibold tracking-tight sm:mr-4"
        >
          <span
            aria-hidden
            className="size-2.5 rounded-full bg-accent shadow-[0_0_12px_var(--accent)]"
          />
          Engram
        </Link>
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={cn(
              'rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:px-3',
              path.startsWith(l.href) && 'bg-muted text-foreground',
            )}
          >
            {l.label}
          </Link>
        ))}
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}
