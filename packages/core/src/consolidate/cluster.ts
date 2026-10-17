// Grouping recent turns for consolidation (SPEC §8): by namespace and session,
// split where the conversation drifts, capped in size. Only extracted user and
// assistant turns qualify; tool output never plants facts here either.
import { config } from '../config/index.js';
import type { Queryable } from '../db/client.js';
import { cosine, fromSql } from '../db/vector.js';
import type { EpisodeRole } from '../types/index.js';

export interface ClusterTurn {
  id: string;
  sessionId: string;
  role: EpisodeRole;
  content: string;
  occurredAt: Date;
  importance: number;
  embedding: number[] | null;
}

export interface Cluster {
  namespaceId: string;
  sessionId: string;
  turns: ClusterTurn[];
  maxImportance: number;
}

/** The consolidation settings, widened so tests and jobs can override them. */
export type ConsolidationConfig = { readonly [K in keyof typeof config.consolidation]: number };
type Cfg = ConsolidationConfig;

/** Splits one session's turns (in time order) on embedding drift and size. */
export function splitSession(
  turns: readonly ClusterTurn[],
  cfg: Cfg = config.consolidation,
): ClusterTurn[][] {
  const out: ClusterTurn[][] = [];
  let current: ClusterTurn[] = [];
  for (const t of turns) {
    const prev = current.at(-1);
    const drifted =
      prev?.embedding && t.embedding
        ? cosine(prev.embedding, t.embedding) < cfg.driftThreshold
        : false;
    if (current.length >= cfg.maxClusterSize || (current.length > 0 && drifted)) {
      out.push(current);
      current = [];
    }
    current.push(t);
  }
  if (current.length > 0) out.push(current);
  return out;
}

/**
 * Clusters awaiting consolidation, longest sessions first (those with at least
 * `maxClusterSize` waiting turns), then oldest first.
 */
export async function pendingClusters(
  db: Queryable,
  options: { namespaceId?: string } = {},
  cfg: Cfg = config.consolidation,
): Promise<Cluster[]> {
  const rows = await db<
    (Omit<ClusterTurn, 'embedding'> & { namespaceId: string; embedding: string | null })[]
  >`
    select id, namespace_id, session_id, role, content, occurred_at, importance, embedding::text as embedding
    from episodes
    where kind = 'turn' and role <> 'tool' and not consolidated and processed_at is not null
      ${options.namespaceId ? db`and namespace_id = ${options.namespaceId}` : db``}
    order by namespace_id, session_id, occurred_at, content`;
  const sessions = new Map<
    string,
    { namespaceId: string; sessionId: string; turns: ClusterTurn[] }
  >();
  for (const r of rows) {
    const key = `${r.namespaceId}/${r.sessionId}`;
    const s = sessions.get(key) ?? {
      namespaceId: r.namespaceId,
      sessionId: r.sessionId,
      turns: [],
    };
    s.turns.push({ ...r, embedding: r.embedding === null ? null : fromSql(r.embedding) });
    sessions.set(key, s);
  }
  const ordered = [...sessions.values()].sort((a, b) => {
    const big = (s: typeof a) => (s.turns.length >= cfg.maxClusterSize ? 0 : 1);
    return (
      big(a) - big(b) ||
      (a.turns[0]?.occurredAt.getTime() ?? 0) - (b.turns[0]?.occurredAt.getTime() ?? 0)
    );
  });
  return ordered.flatMap((s) =>
    splitSession(s.turns, cfg).map((turns) => ({
      namespaceId: s.namespaceId,
      sessionId: s.sessionId,
      turns,
      maxImportance: Math.max(...turns.map((t) => t.importance)),
    })),
  );
}
