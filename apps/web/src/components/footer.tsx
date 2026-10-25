import Link from 'next/link';
import { BrandImage } from './brand/brand-image';

const REPO = 'https://github.com/Pranav-Singh-Devloper/Engram';

const COLUMNS = [
  {
    title: 'Try it',
    links: [
      { href: '/chat', label: 'Chat demo' },
      { href: '/memories', label: 'Memories' },
      { href: '/evals', label: 'Benchmarks' },
    ],
  },
  {
    title: 'Learn',
    links: [
      { href: '/architecture', label: 'Architecture' },
      { href: `${REPO}/blob/main/docs/architecture.md`, label: 'Design notes' },
      { href: `${REPO}/blob/main/DECISIONS.md`, label: 'Decision log' },
    ],
  },
  {
    title: 'Build with it',
    links: [
      { href: REPO, label: 'GitHub' },
      { href: `${REPO}/blob/main/docs/mcp.md`, label: 'MCP setup' },
      { href: `${REPO}/blob/main/docs/local.md`, label: 'Local mode' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-24 border-t">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 md:grid-cols-[1.4fr_2fr_auto]">
        <div>
          <BrandImage name="wordmark" alt="Engram" width={160} height={55} className="h-9 w-auto" />
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">
            A persistent memory engine for AI agents: every fact with the time it was true and the
            time it was believed.
          </p>
        </div>
        <nav className="grid grid-cols-2 gap-6 text-sm sm:grid-cols-3" aria-label="Footer">
          {COLUMNS.map((c) => (
            <div key={c.title}>
              <p className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
                {c.title}
              </p>
              <ul className="mt-2 space-y-1.5">
                {c.links.map((l) => (
                  <li key={l.label}>
                    {l.href.startsWith('http') ? (
                      <a href={l.href} className="hover:text-accent" rel="noreferrer">
                        {l.label}
                      </a>
                    ) : (
                      <Link href={l.href} className="hover:text-accent">
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <BrandImage
          name="badge"
          alt="Engram · memory engine"
          width={120}
          height={120}
          className="h-28 w-28 opacity-90 md:justify-self-end"
        />
      </div>
      <p className="border-t py-4 text-center font-mono text-[11px] text-muted-foreground">
        Built on free tiers · Postgres + pgvector · MCP · every number from a committed report
      </p>
    </footer>
  );
}
