'use client';

// Agents → MCP → Engram → Postgres, with light travelling along the wires
// (SVG animateMotion, which the browser runs off the main thread). Under
// reduced motion the wires are drawn and nothing travels.
import { useReducedMotion } from 'motion/react';
import { useId } from 'react';
import { EngramMark } from '../brand/mark';

const NODES = [
  { id: 'agent', x: 80, label: 'Your agent', sub: 'Claude, Cursor, any MCP client' },
  { id: 'mcp', x: 300, label: 'MCP', sub: '6 tools · stdio or HTTP' },
  { id: 'engram', x: 520, label: 'Engram', sub: 'extract · resolve · recall' },
  { id: 'pg', x: 740, label: 'Postgres', sub: 'pgvector · FTS · versions' },
] as const;

export function BeamFlow() {
  const still = useReducedMotion();
  const uid = useId().replace(/:/g, '');
  const y = 70;
  return (
    <svg
      viewBox="0 0 820 150"
      className="w-full"
      role="img"
      aria-label="Agents reach Engram over MCP; Engram stores in Postgres"
    >
      <defs>
        <linearGradient id={`${uid}-w`} x1="0" x2="1">
          <stop offset="0" stopColor="var(--valid)" />
          <stop offset="0.5" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--record)" />
        </linearGradient>
        <radialGradient id={`${uid}-p`}>
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.4" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      {NODES.slice(0, -1).map((n, i) => {
        const to = NODES[i + 1];
        if (!to) return null;
        const d = `M ${String(n.x + 40)} ${String(y)} C ${String(n.x + 110)} ${String(y - 26)}, ${String(to.x - 110)} ${String(y + 26)}, ${String(to.x - 40)} ${String(y)}`;
        return (
          <g key={n.id}>
            <path d={d} fill="none" stroke="var(--border)" strokeWidth="2" />
            <path d={d} fill="none" stroke={`url(#${uid}-w)`} strokeWidth="2" opacity="0.55" />
            {!still &&
              [0, 1].map((k) => (
                <circle key={k} r="7" fill={`url(#${uid}-p)`}>
                  <animateMotion
                    dur="2.4s"
                    begin={`${String(i * 0.5 + k * 1.2)}s`}
                    repeatCount="indefinite"
                    path={d}
                    keyPoints={k === 0 ? '0;1' : '1;0'}
                    keyTimes="0;1"
                    calcMode="linear"
                  />
                </circle>
              ))}
          </g>
        );
      })}
      {NODES.map((n) => (
        <g key={n.id}>
          <rect
            x={n.x - 40}
            y={y - 30}
            width="80"
            height="60"
            rx="16"
            fill="var(--card)"
            stroke={n.id === 'engram' ? 'var(--accent)' : 'var(--border)'}
            strokeWidth={n.id === 'engram' ? 1.5 : 1}
          />
          {n.id === 'engram' ? (
            <foreignObject x={n.x - 18} y={y - 15} width="36" height="30">
              <EngramMark className="h-[30px] w-auto text-foreground" title="" />
            </foreignObject>
          ) : (
            <text
              x={n.x}
              y={y + 5}
              textAnchor="middle"
              className="fill-foreground font-mono text-[12px]"
            >
              {n.id === 'agent' ? 'agent' : n.id === 'mcp' ? 'mcp' : 'pg'}
            </text>
          )}
          <text
            x={n.x}
            y={y + 52}
            textAnchor="middle"
            className="fill-foreground text-[12px] font-medium"
          >
            {n.label}
          </text>
          <text
            x={n.x}
            y={y + 68}
            textAnchor="middle"
            className="fill-muted-foreground text-[10px]"
          >
            {n.sub}
          </text>
        </g>
      ))}
    </svg>
  );
}
