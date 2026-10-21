'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Cite } from '../cite';
import { SCHEMA, TABLE_INFO, indexKind } from '../data/schema';

const Diagram = dynamic(() => import('./storage-diagram'), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center text-xs text-muted-foreground">
      loading the diagram…
    </div>
  ),
});

function useDark() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => {
      setDark(!root.classList.contains('light'));
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => {
      mo.disconnect();
    };
  }, []);
  return dark;
}

const KEY_INDEXES = [
  {
    title: 'HNSW on three embeddings',
    body: 'facts, episodes and entities each carry a vector(768) with an HNSW index over cosine distance, a navigable small-world graph that answers nearest-neighbour queries without scanning',
    cite: 'malkov2016',
    after:
      '. Recall turns on pgvector’s iterative scan (relaxed order) so a filtered search still fills its candidate list, then re-ranks by exact cosine, because the scan returns near-ties in no fixed order.',
  },
  {
    title: 'GIN full text',
    body: 'English tsvectors over fact statements and episode content feed the full-text list, ranked by ts_rank. It finds exact words embeddings blur: names, drugs, numbers.',
  },
  {
    title: 'The current-belief partial index',
    body: '(namespace_id, subject_id, predicate) where invalidated_at is null: conflict resolution asks “what do we believe now about this subject and predicate?” on every candidate, and only current beliefs are ever in that index.',
  },
  {
    title: 'One self per namespace',
    body: 'A unique index on namespace_id where is_self: Postgres, not application code, guarantees each namespace has exactly one “the user”.',
  },
];

export function Storage() {
  const dark = useDark();
  const [selected, setSelected] = useState<string | null>('facts');
  const table = SCHEMA.tables.find((t) => t.name === selected);
  const checks = table?.constraints.filter((c) => c.kind === 'check') ?? [];
  return (
    <div>
      <p className="max-w-3xl text-muted-foreground">
        One Postgres database holds everything: relational rows, vectors (pgvector) and full-text
        indexes, so a recall is one transaction under one as-of filter and nothing has to be kept in
        sync with a separate vector store. All objects live in the{' '}
        <code className="font-mono text-sm">engram</code> schema. The diagram is read from
        Postgres’s own catalog after all {SCHEMA.migrations.length} migrations, so it can’t drift
        from the SQL. Click a table; drag them around.
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_19rem]">
        <div className="h-96 overflow-hidden rounded-lg border bg-card sm:h-150">
          <Diagram selected={selected} onSelect={setSelected} dark={dark} />
        </div>
        <div className="space-y-3 text-xs">
          {table ? (
            <>
              <div className="rounded-lg border bg-card p-3">
                <p className="font-mono text-sm font-semibold">{table.name}</p>
                <p className="mt-1 text-muted-foreground">{TABLE_INFO[table.name]?.about}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="font-mono text-[11px] text-muted-foreground">
                  indexes ({table.indexes.length})
                </p>
                <ul className="mt-1.5 space-y-1.5">
                  {table.indexes.map((i) => {
                    const k = indexKind(i.definition);
                    return (
                      <li key={i.name}>
                        <span className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              'rounded px-1 font-mono text-[9px]',
                              k.label === 'HNSW'
                                ? 'bg-accent/15 text-accent'
                                : k.label === 'GIN full text'
                                  ? 'bg-success/15 text-success'
                                  : k.label === 'partial'
                                    ? 'bg-valid/15 text-valid'
                                    : 'bg-muted text-muted-foreground',
                            )}
                          >
                            {k.label}
                          </span>
                          <span className="truncate font-mono">{i.name}</span>
                        </span>
                        <span className="text-[10px] text-muted-foreground">{k.why}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
              {checks.length > 0 && (
                <div className="rounded-lg border bg-card p-3">
                  <p className="font-mono text-[11px] text-muted-foreground">
                    checks Postgres enforces ({checks.length})
                  </p>
                  <ul className="mt-1.5 max-h-48 space-y-1 overflow-y-auto font-mono text-[10px]">
                    {checks.map((c) => (
                      <li key={c.name} className="wrap-break-word text-muted-foreground">
                        {c.definition.replace(/^CHECK /, '')}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p className="rounded-lg border bg-card p-3 text-muted-foreground">
              Pick a table to see its indexes and checks.
            </p>
          )}
          <p className="px-1 text-[10px] text-muted-foreground">
            <span className="text-record">PK</span> primary key ·{' '}
            <span className="text-valid">FK</span> foreign key ·{' '}
            <span className="text-accent">↺</span> points at another version of the same table · dim
            names are nullable
          </p>
        </div>
      </div>

      <h3 className="mt-10 text-lg font-semibold">The indexes that carry the engine</h3>
      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        {KEY_INDEXES.map((k) => (
          <div key={k.title} className="rounded-lg border p-4">
            <h4 className="font-medium">{k.title}</h4>
            <p className="mt-1 text-muted-foreground">
              {k.body}
              {k.cite && <Cite k={k.cite} />}
              {k.after}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-3 text-sm lg:grid-cols-2">
        <div className="rounded-lg border p-4">
          <h3 className="font-medium">Locks: one per namespace, per transaction</h3>
          <p className="mt-1 text-muted-foreground">
            Resolving a turn reads current beliefs and writes new versions, so two turns for the
            same namespace must not interleave. Each takes{' '}
            <code className="font-mono text-xs">
              pg_advisory_xact_lock(hashtextextended(&apos;engram:ns:&lt;id&gt;&apos;, 0))
            </code>{' '}
            inside its transaction. A transaction-scoped lock is released at commit, so it’s safe
            behind a connection pooler, where a session lock could outlive its owner on a shared
            connection. No model call ever runs under it. Rule decisions apply at once; when a case
            needs the LLM adjudicator, the transaction ends, the model is asked outside it, and the
            answer is applied in a new locked transaction only if a fingerprint of the current
            beliefs hasn’t changed meanwhile, otherwise it retries. A slow provider can’t stall
            other writers.
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <h3 className="font-medium">Two databases, one set of migrations</h3>
          <table className="mt-2 w-full text-xs">
            <tbody className="[&_td]:py-1 [&_td]:align-top">
              <tr className="border-b">
                <td className="pr-3 text-muted-foreground">local</td>
                <td>
                  Docker <code className="font-mono">pgvector/pgvector:0.8.7-pg17</code> on port
                  54329: dev, tests, every bench run
                </td>
              </tr>
              <tr className="border-b">
                <td className="pr-3 text-muted-foreground">hosted</td>
                <td>
                  Neon free: Postgres 18.6, pgvector 0.8.6, 1 GB, 100 CU-hours a month, scales to
                  zero after 5 idle minutes. Never benched against (ADR-014).
                </td>
              </tr>
              <tr className="border-b">
                <td className="pr-3 text-muted-foreground">portable</td>
                <td>
                  {SCHEMA.migrations.length} files in{' '}
                  <code className="font-mono">sql/migrations</code>, applied to both, each
                  checksummed so none can be edited after it ran
                </td>
              </tr>
              <tr>
                <td className="pr-3 text-muted-foreground">hosted-only</td>
                <td>
                  <code className="font-mono">sql/hosted</code>: a database-level search path
                  (Neon’s proxy drops the startup parameter), and API-role revokes that run only
                  where those roles exist
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            Postgres functions:{' '}
            {SCHEMA.functions.map((f, i) => (
              <span key={f.name}>
                {i > 0 && ', '}
                <code className="font-mono">{f.name}</code>
              </span>
            ))}
            . The decay sweep takes <code className="font-mono">now</code> as a parameter, so tests
            drive it with a simulated clock.
          </p>
        </div>
      </div>
    </div>
  );
}
