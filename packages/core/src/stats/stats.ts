// What's in a namespace (SPEC §10 `engram://stats`): current beliefs by tier
// and status, episodes, entities, the ad-hoc predicate rate and the last sweep.
import type { Queryable } from '../db/client.js';
import { one } from '../db/rows.js';
import { lastSweep } from '../decay/sweep.js';
import { FACT_STATUSES, FACT_TIERS } from '../types/index.js';
import type { FactStatus, FactTier } from '../types/index.js';

export interface NamespaceStats {
  /** Current beliefs (not replaced by a newer version), by tier and by status. */
  facts: {
    total: number;
    byTier: Record<FactTier, number>;
    byStatus: Record<FactStatus, number>;
    /** Share of current beliefs whose predicate isn't in the registry. */
    adHocRate: number;
  };
  episodes: { turns: number; summaries: number; unprocessed: number; unconsolidated: number };
  /** Excluding the self entity. */
  entities: number;
  lastSweep: Date | null;
}

export async function namespaceStats(db: Queryable, namespaceId: string): Promise<NamespaceStats> {
  const groups = await db<{ tier: FactTier; status: FactStatus; adHoc: boolean; n: number }[]>`
    select tier, status, predicate_ad_hoc as ad_hoc, count(*)::int as n from facts
    where namespace_id = ${namespaceId} and invalidated_at is null
    group by tier, status, predicate_ad_hoc`;
  const byTier = Object.fromEntries(FACT_TIERS.map((t) => [t, 0])) as Record<FactTier, number>;
  const byStatus = Object.fromEntries(FACT_STATUSES.map((s) => [s, 0])) as Record<
    FactStatus,
    number
  >;
  let total = 0;
  let adHoc = 0;
  for (const g of groups) {
    byTier[g.tier] += g.n;
    byStatus[g.status] += g.n;
    total += g.n;
    if (g.adHoc) adHoc += g.n;
  }
  const counts = one(
    await db<
      {
        turns: number;
        summaries: number;
        unprocessed: number;
        unconsolidated: number;
        entities: number;
      }[]
    >`
      select
        count(*) filter (where kind = 'turn')::int as turns,
        count(*) filter (where kind = 'summary')::int as summaries,
        count(*) filter (where processed_at is null)::int as unprocessed,
        count(*) filter (where kind = 'turn' and not consolidated and role <> 'tool')::int as unconsolidated,
        (select count(*)::int from entities where namespace_id = ${namespaceId} and not is_self) as entities
      from episodes where namespace_id = ${namespaceId}`,
  );
  const { entities, ...episodes } = counts;
  return {
    facts: { total, byTier, byStatus, adHocRate: total === 0 ? 0 : adHoc / total },
    episodes,
    entities,
    lastSweep: await lastSweep(db, namespaceId),
  };
}
