import { REFERENCES } from '@/content/references';

export function References() {
  return (
    <div>
      <p className="max-w-3xl text-muted-foreground">
        Every work cited on this page, checked against its arXiv entry, DOI or publisher on
        2026-10-21. Venues appear only where that check confirmed them. Each entry says what Engram
        took from it, or how it differs.
      </p>
      <ol className="mt-6 space-y-4">
        {REFERENCES.map((r, i) => (
          <li
            key={r.key}
            id={`ref-${r.key}`}
            className="scroll-mt-24 grid grid-cols-[2.5rem_1fr] gap-2 text-sm"
          >
            <span className="font-mono text-xs text-accent">[{i + 1}]</span>
            <div>
              <p>
                {r.authors}{' '}
                {r.url ? (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium underline decoration-dotted underline-offset-2 hover:text-accent"
                  >
                    {r.title}
                  </a>
                ) : (
                  <span className="font-medium">{r.title}</span>
                )}
                . <span className="text-muted-foreground">{r.venue}.</span>
              </p>
              <p className="mt-1 text-muted-foreground">
                <span className="font-mono text-[11px] tracking-wide uppercase">Engram</span> ·{' '}
                {r.took}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
