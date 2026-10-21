'use client';

import { useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Cite } from '../cite';

type Flow = 'write' | 'read' | 'background';

interface Node {
  id: string;
  label: string;
  sub: string;
  x: number;
  y: number;
  w?: number;
  /** The chapter that explains it, linked once that chapter is published. */
  chapter?: string;
  detail: string;
}

const NODES: Node[] = [
  {
    id: 'mcp',
    label: 'MCP clients',
    sub: 'Claude Code, Cursor…',
    x: 30,
    y: 70,
    detail:
      'Any MCP client calls six tools: remember, recall, entities, history, forget and consolidate, over stdio or streamable HTTP.',
  },
  {
    id: 'rest',
    label: 'REST API',
    sub: 'bearer token',
    x: 30,
    y: 215,
    detail: 'POST /api/remember and /api/recall, scoped to the namespace a token maps to.',
  },
  {
    id: 'chat',
    label: 'Chat demo',
    sub: 'cookie session',
    x: 30,
    y: 360,
    detail:
      'Anonymous 24-hour namespaces, rate-limited per IP, per namespace and globally, so the free quota is safe.',
  },
  {
    id: 'iface',
    label: 'Interfaces',
    sub: 'auth · limits',
    x: 220,
    y: 215,
    chapter: 'interfaces',
    detail:
      'One server factory behind both MCP transports, and thin route handlers over the engine.',
  },
  {
    id: 'ingest',
    label: 'Ingest',
    sub: 'episode + embedding',
    x: 400,
    y: 70,
    chapter: 'write-path',
    detail:
      'Every turn is stored verbatim as an episode and embedded at once, so it is recallable before any extraction finishes.',
  },
  {
    id: 'extract',
    label: 'Extract',
    sub: 'one validated call',
    x: 580,
    y: 70,
    chapter: 'write-path',
    detail:
      'One model call returns importance and fact candidates, validated with zod; time hints are resolved against when the turn was said.',
  },
  {
    id: 'resolve',
    label: 'Resolve',
    sub: 'entities · conflicts',
    x: 760,
    y: 70,
    chapter: 'resolution',
    detail:
      'Entities are matched by name, alias, embedding or a model call; each candidate is inserted, merged, updated, backfilled, corrected, kept alongside or rejected.',
  },
  {
    id: 'store',
    label: 'Postgres + pgvector',
    sub: 'bitemporal fact versions',
    x: 760,
    y: 215,
    w: 170,
    chapter: 'storage',
    detail:
      'Episodes, entities and immutable fact versions with valid time and record time, indexed by HNSW, full text and the entity graph.',
  },
  {
    id: 'recall',
    label: 'Recall',
    sub: 'lists · RRF · floor',
    x: 580,
    y: 360,
    chapter: 'recall',
    detail:
      'Four candidate lists fused by reciprocal rank, with mild priors and an abstention floor.',
  },
  {
    id: 'compose',
    label: 'Compose',
    sub: 'answer + used ids',
    x: 400,
    y: 360,
    detail: 'One model call answers from the recalled memories only and says which ones it used.',
  },
  {
    id: 'consolidate',
    label: 'Consolidate',
    sub: 'nightly',
    x: 760,
    y: 360,
    chapter: 'consolidation',
    detail:
      'Session turns are clustered and summarized into long-term facts through the same resolution pipeline.',
  },
  {
    id: 'decay',
    label: 'Decay sweep',
    sub: 'nightly',
    x: 940,
    y: 360,
    chapter: 'decay',
    detail:
      'Retention scores fall on a forgetting curve; facts below the archive threshold are archived, never deleted.',
  },
];

const W = 150;
const H = 62;
const center = (id: string) => {
  const n = NODES.find((x) => x.id === id);
  if (!n) return { x: 0, y: 0 };
  return { x: n.x + (n.w ?? W) / 2, y: n.y + H / 2 };
};
/** A gentle curve between two node centers. */
function edge(a: string, b: string, bend = 0) {
  const p = center(a);
  const q = center(b);
  const mx = (p.x + q.x) / 2;
  const my = (p.y + q.y) / 2 + bend;
  return `M ${String(p.x)} ${String(p.y)} Q ${String(mx)} ${String(my)} ${String(q.x)} ${String(q.y)}`;
}

const FLOWS: Record<Flow, { color: string; label: string; paths: string[] }> = {
  write: {
    color: 'var(--accent)',
    label: 'Write path',
    paths: [
      edge('mcp', 'iface'),
      edge('rest', 'iface'),
      edge('chat', 'iface'),
      edge('iface', 'ingest', -20),
      edge('ingest', 'extract'),
      edge('extract', 'resolve'),
      edge('resolve', 'store'),
    ],
  },
  read: {
    color: 'var(--valid)',
    label: 'Read path',
    paths: [
      edge('chat', 'iface'),
      edge('iface', 'recall', 40),
      edge('store', 'recall', 20),
      edge('recall', 'compose'),
      edge('compose', 'iface', -10),
    ],
  },
  background: {
    color: 'var(--record)',
    label: 'Background jobs',
    paths: [
      edge('store', 'consolidate', -20),
      edge('consolidate', 'store', 30),
      edge('store', 'decay', -30),
      edge('decay', 'store', 30),
    ],
  },
};

export function Overview({ published }: { published: ReadonlySet<string> }) {
  const [flow, setFlow] = useState<Flow>('write');
  const [picked, setPicked] = useState<string>('extract');
  const still = useReducedMotion();
  const node = NODES.find((n) => n.id === picked);
  const f = FLOWS[flow];
  return (
    <div>
      <p className="max-w-3xl text-muted-foreground">
        Engram is a memory service, not an agent: any client remembers and recalls through it, the
        way MemGPT’s agent pages its own memory
        <Cite k="packer2023" /> but outside the agent. Writes are cheap and immediate; the expensive
        understanding happens once, at ingest, and is reused by every later question. Choose a path
        to watch it move.
      </p>
      <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Data flow">
        {(Object.keys(FLOWS) as Flow[]).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={flow === k}
            onClick={() => {
              setFlow(k);
            }}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-sm transition-colors',
              flow === k ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
            style={
              flow === k
                ? {
                    borderColor: FLOWS[k].color,
                    background: `color-mix(in oklch, ${FLOWS[k].color} 12%, transparent)`,
                  }
                : undefined
            }
          >
            {FLOWS[k].label}
          </button>
        ))}
      </div>
      <div className="mt-4 overflow-x-auto rounded-lg border bg-card">
        <svg
          viewBox="0 0 1110 450"
          className="min-w-[720px]"
          role="img"
          aria-label={`${f.label} through Engram`}
        >
          <defs>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {f.paths.map((d, i) => (
            <g key={`${flow}-${String(i)}`}>
              <path d={d} fill="none" stroke={f.color} strokeOpacity={0.35} strokeWidth={2} />
              {!still &&
                [0, 1, 2].map((k) => (
                  <circle key={k} r={3.5} fill={f.color} filter="url(#glow)">
                    <animateMotion
                      dur="2.4s"
                      begin={`${String(k * 0.8 + i * 0.15)}s`}
                      repeatCount="indefinite"
                      path={d}
                    />
                  </circle>
                ))}
            </g>
          ))}
          {NODES.map((n) => {
            const active = picked === n.id;
            return (
              <g
                key={n.id}
                transform={`translate(${String(n.x)},${String(n.y)})`}
                className="cursor-pointer"
                onClick={() => {
                  setPicked(n.id);
                }}
                role="button"
                aria-label={n.label}
              >
                <rect
                  width={n.w ?? W}
                  height={H}
                  rx={10}
                  fill="var(--card)"
                  stroke={active ? 'var(--accent)' : 'var(--border)'}
                  strokeWidth={active ? 2 : 1}
                />
                <text x={12} y={26} className="fill-foreground text-[14px] font-medium">
                  {n.label}
                </text>
                <text x={12} y={45} className="fill-muted-foreground font-mono text-[11px]">
                  {n.sub}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {node && (
        <div className="mt-3 rounded-lg border bg-card p-4 text-sm">
          <p className="font-medium">{node.label}</p>
          <p className="mt-1 text-muted-foreground">{node.detail}</p>
          {node.chapter && published.has(node.chapter) && (
            <a href={`#${node.chapter}`} className="mt-2 inline-block text-accent hover:underline">
              Read the chapter →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
