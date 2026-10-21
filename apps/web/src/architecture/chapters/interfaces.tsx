'use client';

import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { DEMO_LIMITS, MCP_CATALOG, ROUTES, SEQUENCES } from '../data/interfaces';
import type { Credential, Grant } from '../data/interfaces';
import { useWidth } from '../use-width';

const CREDENTIALS: { key: Credential; label: string }[] = [
  { key: 'token', label: 'bearer token' },
  { key: 'cookie', label: 'demo cookie' },
  { key: 'none', label: 'neither' },
];

const GRANT_STYLE: Record<Grant, string> = {
  'own namespace': 'bg-success/15 text-success',
  'demo namespace': 'bg-valid/15 text-valid',
  'showcase, read-only': 'bg-record/15 text-record',
  public: 'bg-muted text-muted-foreground',
  '401': 'bg-danger/10 text-danger',
};

function Tools() {
  const [open, setOpen] = useState<string | null>('engram_recall');
  return (
    <div className="space-y-1.5">
      {MCP_CATALOG.tools.map((t) => {
        const a = t.annotations;
        const isOpen = open === t.name;
        return (
          <div key={t.name} className="rounded-lg border bg-card">
            <button
              onClick={() => {
                setOpen(isOpen ? null : t.name);
              }}
              aria-expanded={isOpen}
              className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left"
            >
              <code className="font-mono text-xs text-accent">{t.name}</code>
              <span className="text-xs text-muted-foreground">{t.title}</span>
              <span className="ml-auto flex gap-1">
                {a.readOnlyHint && (
                  <span className="rounded bg-muted px-1 font-mono text-[9px]">read-only</span>
                )}
                {a.destructiveHint && (
                  <span className="rounded bg-danger/15 px-1 font-mono text-[9px] text-danger">
                    destructive
                  </span>
                )}
                {a.idempotentHint && (
                  <span className="rounded bg-muted px-1 font-mono text-[9px]">idempotent</span>
                )}
              </span>
            </button>
            {isOpen && (
              <div className="border-t px-3 py-2 text-xs">
                <p className="text-muted-foreground">{t.description}</p>
                {t.params.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {t.params.map((p) => (
                      <li key={p.name}>
                        <code className="font-mono">
                          {p.name}
                          {p.required && <span className="text-danger">*</span>}
                        </code>{' '}
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {p.type}
                        </span>
                        {p.description && (
                          <span className="block text-[11px] text-muted-foreground">
                            {p.description}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        );
      })}
      {MCP_CATALOG.resources.map((r) => (
        <div key={r.uri} className="rounded-lg border border-dashed px-3 py-2 text-xs">
          <code className="font-mono text-valid">{r.uri}</code>{' '}
          <span className="text-muted-foreground">resource · {r.description}</span>
        </div>
      ))}
    </div>
  );
}

function AuthMatrix() {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 font-mono text-[10px] text-muted-foreground">
          <tr>
            <th className="px-2.5 py-2 text-left font-normal">route</th>
            {CREDENTIALS.map((c) => (
              <th key={c.key} className="px-2 py-2 text-left font-normal">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROUTES.map((r) => (
            <tr key={r.path} className="border-t align-top">
              <td className="px-2.5 py-1.5">
                <code className="font-mono">
                  <span className="text-muted-foreground">{r.methods.join(' ')}</span> {r.path}
                </code>
                <span className="block text-[10px] text-muted-foreground">{r.what}</span>
                {r.limits && <span className="block text-[10px] text-record">{r.limits}</span>}
              </td>
              {CREDENTIALS.map((c) => (
                <td key={c.key} className="px-2 py-1.5">
                  <span
                    className={cn(
                      'inline-block rounded px-1.5 py-0.5 text-[10px] whitespace-nowrap',
                      GRANT_STYLE[r.access[c.key]],
                    )}
                  >
                    {r.access[c.key]}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Sequence() {
  const still = useReducedMotion();
  const [flow, setFlow] = useState<keyof typeof SEQUENCES>('mcp');
  const seq = SEQUENCES[flow];
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [box, W] = useWidth<HTMLDivElement>();
  useEffect(() => {
    if (!playing || !seq) return;
    if (step >= seq.steps.length) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(
      () => {
        setStep((s) => s + 1);
      },
      still ? 0 : 1100,
    );
    return () => {
      clearTimeout(t);
    };
  }, [playing, step, seq, still]);
  if (!seq) return null;
  const narrow = W < 560;
  const lanePad = narrow ? 34 : 60;
  const laneX = (name: string) => {
    const i = seq.lanes.indexOf(name);
    return lanePad + (i * (W - 2 * lanePad)) / Math.max(1, seq.lanes.length - 1);
  };
  const ROW = 40;
  const top = 44;
  const deferredFrom = seq.steps.findIndex((s) => s.deferred);
  const rowY = (i: number) => top + i * ROW + (deferredFrom >= 0 && i >= deferredFrom ? 26 : 0);
  const H = rowY(seq.steps.length) + 10;
  const current = seq.steps[step - 1];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {Object.keys(SEQUENCES).map((f) => (
          <button
            key={f}
            onClick={() => {
              setFlow(f);
              setStep(0);
              setPlaying(false);
            }}
            className={cn(
              'rounded-md border px-2.5 py-1 text-xs',
              flow === f ? 'border-accent bg-accent/10' : 'text-muted-foreground',
            )}
          >
            {SEQUENCES[f]?.title}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1">
          <button
            aria-label="Previous step"
            onClick={() => {
              setStep((s) => Math.max(0, s - 1));
            }}
            className="grid size-7 place-items-center rounded-md border text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <button
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={() => {
              if (step >= seq.steps.length) setStep(0);
              setPlaying(!playing);
            }}
            className="grid size-7 place-items-center rounded-md border text-muted-foreground hover:text-foreground"
          >
            {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </button>
          <button
            aria-label="Next step"
            onClick={() => {
              setStep((s) => Math.min(seq.steps.length, s + 1));
            }}
            className="grid size-7 place-items-center rounded-md border text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className="size-3.5" />
          </button>
          <span className="w-12 text-right font-mono text-[10px] text-muted-foreground">
            {step}/{seq.steps.length}
          </span>
        </span>
      </div>
      <div ref={box} className="mt-3 rounded-lg border bg-card p-2">
        <svg width={W} height={H} role="img" aria-label={seq.title}>
          <defs>
            <marker
              id="seq-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 z" fill="var(--accent)" />
            </marker>
            <marker
              id="seq-arrow-dim"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 z" fill="var(--muted-foreground)" />
            </marker>
          </defs>
          {seq.lanes.map((l) => (
            <g key={l}>
              <text
                x={laneX(l)}
                y={16}
                textAnchor="middle"
                className="fill-foreground font-mono text-[10px]"
              >
                {l}
              </text>
              <line
                x1={laneX(l)}
                x2={laneX(l)}
                y1={24}
                y2={H}
                stroke="var(--border)"
                strokeDasharray="3 4"
              />
            </g>
          ))}
          {deferredFrom >= 0 && (
            <g>
              <line
                x1={4}
                x2={W - 4}
                y1={rowY(deferredFrom) - 22}
                y2={rowY(deferredFrom) - 22}
                stroke="var(--record)"
                strokeDasharray="6 4"
              />
              <text x={6} y={rowY(deferredFrom) - 27} className="fill-record text-[10px]">
                response sent · the rest runs in after()
              </text>
            </g>
          )}
          {seq.steps.map((s, i) => {
            const x1 = laneX(s.from);
            const x2 = laneX(s.to);
            const y = rowY(i);
            const shown = i < step;
            const active = i === step - 1;
            const dir = x2 >= x1 ? 1 : -1;
            return (
              <g
                key={i}
                style={{
                  opacity: shown ? 1 : 0,
                  transform: shown ? 'none' : `translateX(${String(-8 * dir)}px)`,
                  transition: still ? undefined : 'opacity 350ms, transform 350ms',
                }}
              >
                <line
                  x1={x1}
                  x2={x2 - dir * 4}
                  y1={y}
                  y2={y}
                  stroke={active ? 'var(--accent)' : 'var(--muted-foreground)'}
                  strokeWidth={active ? 2 : 1.25}
                  strokeDasharray={s.deferred ? '5 3' : undefined}
                  markerEnd={`url(#${active ? 'seq-arrow' : 'seq-arrow-dim'})`}
                />
                {!narrow && (
                  <text
                    x={(x1 + x2) / 2}
                    y={y - 6}
                    textAnchor="middle"
                    className={cn(
                      'text-[10px]',
                      active ? 'fill-foreground font-medium' : 'fill-muted-foreground',
                    )}
                  >
                    {s.label.length > 70 ? `${s.label.slice(0, 68)}…` : s.label}
                  </text>
                )}
                {narrow && (
                  <text
                    x={Math.min(x1, x2) + 2}
                    y={y - 5}
                    className="fill-muted-foreground font-mono text-[9px]"
                  >
                    {i + 1}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <p className="mt-2 min-h-10 text-xs">
        {current ? (
          <>
            <span className="font-mono text-accent">{step}.</span> {current.label}
            {current.note && <span className="text-muted-foreground"> · {current.note}</span>}
          </>
        ) : (
          <span className="text-muted-foreground">Press play, or step through.</span>
        )}
      </p>
    </div>
  );
}

function Limits() {
  const stages = [
    {
      t: 'a visitor',
      d: `mints a demo session: ${String(DEMO_LIMITS.sessionsPerIpHour)} an hour and ${String(DEMO_LIMITS.sessionsPerIpDay)} a day per IP`,
      k: 'keyed by HMAC(day ‖ IP), never the address',
    },
    {
      t: 'a namespace',
      d: `${String(DEMO_LIMITS.turnsPerNamespaceHour)} chat turns an hour`,
      k: 'rate_limits, one atomic upsert',
    },
    {
      t: 'the whole demo',
      d: `${String(DEMO_LIMITS.dailyTurnCap)} turns a day`,
      k: 'throttles, one atomic upsert; the real bound on spend',
    },
    {
      t: 'Gemini',
      d: `~${String(DEMO_LIMITS.dailyTurnCap * 3)} generate calls at most`,
      k: 'of 500 a key',
    },
  ];
  return (
    <ol className="grid gap-2 sm:grid-cols-4">
      {stages.map((s, i) => (
        <li
          key={s.t}
          className="relative rounded-lg border bg-card p-3"
          style={{ opacity: 1 - i * 0.08 }}
        >
          <p className="font-mono text-[10px] text-accent">{String(i + 1).padStart(2, '0')}</p>
          <p className="mt-0.5 text-sm font-medium">{s.t}</p>
          <p className="mt-1 text-xs">{s.d}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">{s.k}</p>
        </li>
      ))}
    </ol>
  );
}

export function Interfaces() {
  return (
    <div>
      <p className="max-w-3xl text-muted-foreground">
        Agents reach Engram over the Model Context Protocol, as six tools and one resource, through
        a stdio server for local clients (Claude Code, Claude Desktop, Cursor) or streamable HTTP at{' '}
        <code className="font-mono text-sm">/api/mcp</code>. The tool list below isn’t a copy: the
        build starts the real stdio server and asks it, as any client would (protocol{' '}
        {MCP_CATALOG.protocolVersion}). The web app adds a small REST surface and the public demo.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[22rem_1fr]">
        <div>
          <h3 className="text-sm font-semibold">MCP tools</h3>
          <div className="mt-2">
            <Tools />
          </div>
        </div>
        <div>
          <h3 className="text-sm font-semibold">REST: who can call what</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            One token model for MCP and REST: <code>ENGRAM_MCP_TOKENS</code> maps each token to its
            namespace, compared in constant time. Reads with no credential see the showcase,
            read-only. Tested against the route files in <code>app/api</code>.
          </p>
          <div className="mt-2">
            <AuthMatrix />
          </div>
        </div>
      </div>

      <h3 className="mt-10 text-lg font-semibold">Two requests, step by step</h3>
      <div className="mt-3">
        <Sequence />
      </div>

      <h3 className="mt-8 text-lg font-semibold">How the free demo can’t exhaust the quota</h3>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        Rotating IPs can mint sessions, but they can’t pass the daily cap. A refused turn returns
        429 before any model call. The demo’s namespace slug is the SHA-256 of a random cookie
        secret, so reading the database doesn’t let anyone act as a visitor (ADR-019).
      </p>
      <div className="mt-3">
        <Limits />
      </div>
    </div>
  );
}
