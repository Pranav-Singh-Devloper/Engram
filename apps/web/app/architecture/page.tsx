import type { Metadata } from 'next';
import { Chapter } from '@/architecture/chapter';
import { CHAPTERS } from '@/architecture/registry';
import { MobileToc, Toc } from '@/architecture/toc';

export const metadata: Metadata = {
  title: 'Architecture',
  description:
    'How Engram works and why: every subsystem, interactive, on the repository’s own data, with references.',
};

export default function ArchitecturePage() {
  return (
    <div className="mx-auto max-w-7xl px-4">
      <header className="max-w-3xl pt-16 pb-6">
        <p className="font-mono text-xs tracking-widest text-accent uppercase">Architecture</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          How Engram works, and why it works that way
        </h1>
        <p className="mt-4 text-lg text-muted-foreground text-pretty">
          Every subsystem, with the model behind it, the numbers this repository measured, and the
          research it builds on. The interactive parts run the engine’s own code, and every number
          comes from a committed report.
        </p>
      </header>
      <div className="grid gap-10 lg:grid-cols-[220px_1fr]">
        <aside>
          <Toc entries={CHAPTERS.map(({ id, n, title }) => ({ id, n, title }))} />
        </aside>
        <div className="min-w-0">
          <MobileToc entries={CHAPTERS.map(({ id, n, title }) => ({ id, n, title }))} />
          {CHAPTERS.map((c) => (
            <Chapter key={c.id} id={c.id} n={c.n} title={c.title} kicker={c.kicker}>
              {c.body()}
            </Chapter>
          ))}
        </div>
      </div>
    </div>
  );
}
