// One color and label per bench mode, used by every chart (P09b decision 2).
export const MODE_ORDER = [
  'buffer',
  'rag',
  'full_context',
  'engram',
  'engram_consolidated',
] as const;

export const MODE_STYLE: Record<string, { label: string; color: string }> = {
  buffer: { label: 'buffer', color: 'var(--muted-foreground)' },
  rag: { label: 'rag', color: 'var(--valid)' },
  full_context: { label: 'full context', color: 'var(--record)' },
  engram: { label: 'engram', color: 'var(--accent)' },
  engram_consolidated: {
    label: 'engram + consolidation',
    color: 'color-mix(in oklch, var(--accent) 55%, var(--foreground))',
  },
};

export const CATEGORY_LABEL: Record<string, string> = {
  cross_session_recall: 'cross-session',
  knowledge_update: 'knowledge update',
  temporal_reasoning: 'temporal',
  single_session_recall: 'single-session',
  multi_hop: 'multi-hop',
  abstention: 'abstention',
};

export const SPLIT_LABEL: Record<string, string> = {
  test: 'Test split',
  longmemeval: 'LongMemEval-S',
  'dev-long': 'dev-long',
  dev: 'dev',
};

/** Modes present in a run, in the canonical order. */
export function orderedModes(present: Iterable<string>): string[] {
  const set = new Set(present);
  return [
    ...MODE_ORDER.filter((m) => set.has(m)),
    ...[...set].filter((m) => !(MODE_ORDER as readonly string[]).includes(m)),
  ];
}
