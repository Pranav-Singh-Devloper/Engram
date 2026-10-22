'use client';

// The ER diagram, code-split like the galaxy scene: @xyflow/react loads only
// when chapter 10 mounts. Tables are draggable; the wheel scrolls the page.
import '@xyflow/react/dist/style.css';
import { Background, Controls, Handle, Position, ReactFlow } from '@xyflow/react';
import type { Edge, Node, NodeProps } from '@xyflow/react';
import { useReducedMotion } from 'motion/react';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { SCHEMA, TABLE_INFO, fkColumns } from '../data/schema';
import type { Table } from '../data/schema';

type TableData = { table: Table; selected: boolean; dim: boolean; fks: Set<string> };
type TableNode = Node<TableData, 'table'>;

const short = (type: string) =>
  type
    .replace('timestamp with time zone', 'timestamptz')
    .replace('double precision', 'float8')
    .replace('character varying', 'varchar');

function TableCard({ data }: NodeProps<TableNode>) {
  const { table, selected, dim, fks } = data;
  const pk = new Set(
    table.constraints
      .filter((c) => c.kind === 'primary')
      .flatMap((c) => /\(([^)]+)\)/.exec(c.definition)?.[1]?.split(', ') ?? []),
  );
  const selfRefs = new Set(
    table.constraints
      .filter((c) => c.kind === 'foreign' && c.references === table.name)
      .flatMap((c) => fkColumns(c.definition)),
  );
  return (
    <div
      className={cn(
        'w-[250px] rounded-lg border bg-card text-[10px] shadow-sm transition-opacity duration-300',
        selected ? 'border-accent shadow-[0_0_0_1px_var(--accent)]' : 'border-border',
        dim && 'opacity-35',
      )}
    >
      {(['left', 'right'] as const).map((side) => (
        <span key={side}>
          <Handle
            type="source"
            id={side}
            position={side === 'left' ? Position.Left : Position.Right}
            className="!size-1.5 !border-0 !bg-muted-foreground"
          />
          <Handle
            type="target"
            id={side}
            position={side === 'left' ? Position.Left : Position.Right}
            className="!size-1.5 !border-0 !bg-muted-foreground"
          />
        </span>
      ))}
      <div className="flex items-center justify-between rounded-t-lg border-b bg-muted/60 px-2.5 py-1.5">
        <span className="font-mono text-[11px] font-semibold text-foreground">{table.name}</span>
        <span className="text-muted-foreground">{table.columns.length} cols</span>
      </div>
      <ul className="px-2.5 py-1">
        {table.columns.map((c) => (
          <li key={c.name} className="flex items-center gap-1.5 py-[1px] font-mono">
            <span className="w-5 shrink-0 text-[8px]">
              {pk.has(c.name) ? (
                <span className="text-record">PK</span>
              ) : selfRefs.has(c.name) ? (
                <span className="text-accent">↺</span>
              ) : fks.has(c.name) ? (
                <span className="text-valid">FK</span>
              ) : null}
            </span>
            <span
              className={cn('truncate', c.nullable ? 'text-muted-foreground' : 'text-foreground')}
            >
              {c.name}
            </span>
            <span className="ml-auto shrink-0 text-muted-foreground/80">{short(c.type)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const nodeTypes = { table: TableCard };

export default function StorageDiagram({
  selected,
  onSelect,
  dark,
}: {
  selected: string | null;
  onSelect: (name: string | null) => void;
  dark: boolean;
}) {
  // React Flow's marching-ants edges are a CSS animation; reduced motion keeps them still.
  const still = useReducedMotion() ?? false;
  const { nodes, edges } = useMemo(() => {
    const related = new Set<string>();
    const edges: Edge[] = [];
    for (const t of SCHEMA.tables) {
      for (const c of t.constraints) {
        if (c.kind !== 'foreign' || !c.references || c.references === t.name) continue;
        const from = TABLE_INFO[t.name];
        const to = TABLE_INFO[c.references];
        const leftward = (from?.x ?? 0) > (to?.x ?? 0);
        const hot = selected !== null && (t.name === selected || c.references === selected);
        if (hot) {
          related.add(t.name);
          related.add(c.references);
        }
        edges.push({
          id: c.name,
          source: t.name,
          target: c.references,
          sourceHandle: leftward ? 'left' : 'right',
          targetHandle: leftward ? 'right' : 'left',
          type: 'smoothstep',
          label: fkColumns(c.definition).join(', '),
          labelStyle: { fontSize: 9, fill: 'var(--muted-foreground)' },
          labelBgStyle: { fill: 'var(--card)' },
          animated: hot && !still,
          style: {
            stroke: hot ? 'var(--accent)' : 'var(--border)',
            strokeWidth: hot ? 2 : 1.25,
            opacity: selected === null || hot ? 1 : 0.3,
          },
        });
      }
    }
    const nodes: TableNode[] = SCHEMA.tables.map((t) => ({
      id: t.name,
      type: 'table',
      position: { x: TABLE_INFO[t.name]?.x ?? 0, y: TABLE_INFO[t.name]?.y ?? 0 },
      data: {
        table: t,
        selected: t.name === selected,
        dim: selected !== null && t.name !== selected && !related.has(t.name),
        fks: new Set(
          t.constraints.filter((c) => c.kind === 'foreign').flatMap((c) => fkColumns(c.definition)),
        ),
      },
    }));
    return { nodes, edges };
  }, [selected, still]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      colorMode={dark ? 'dark' : 'light'}
      fitView
      fitViewOptions={{ padding: 0.06 }}
      minZoom={0.15}
      maxZoom={1.6}
      zoomOnScroll={false}
      panOnScroll={false}
      preventScrolling={false}
      nodesConnectable={false}
      onNodeClick={(_, n) => {
        onSelect(n.id === selected ? null : n.id);
      }}
      onPaneClick={() => {
        onSelect(null);
      }}
      style={{ background: 'transparent' }}
    >
      <Background gap={20} size={1} color="var(--border)" />
      <Controls showInteractive={false} position="bottom-right" />
    </ReactFlow>
  );
}
