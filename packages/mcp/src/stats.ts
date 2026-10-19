// The engram://stats resource (SPEC §10): the namespace's store, the last
// decay sweep, and the latest bench score from bench/reports/*.json.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { BenchSummary, namespaceStats } from '@engram/core';
import type { NamespaceStats, Queryable } from '@engram/core';
import { iso } from './format.js';

/**
 * The repo's bench/reports, found from this file's location. Under a bundler
 * (the Next.js app, P09a) there is no source directory at runtime, so it's
 * null there and the app passes its own directory.
 */
export const DEFAULT_REPORTS_DIR: string | null = import.meta.dirname
  ? path.resolve(import.meta.dirname, '../../../bench/reports')
  : null;

/** The newest summary of a run that composed answers, or null if there is none. */
export function latestBenchSummary(dir: string | null): BenchSummary | null {
  if (dir === null) return null;
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return null;
  }
  const summaries = files.flatMap((f) => {
    try {
      const parsed = BenchSummary.safeParse(JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
      return parsed.success && !parsed.data.retrievalOnly ? [parsed.data] : [];
    } catch {
      return [];
    }
  });
  summaries.sort(
    (a, b) => b.finishedAt.localeCompare(a.finishedAt) || b.runId.localeCompare(a.runId),
  );
  return summaries[0] ?? null;
}

export interface StatsDocument {
  namespace: string;
  facts: NamespaceStats['facts'];
  episodes: NamespaceStats['episodes'];
  entities: number;
  lastSweep: string | null;
  bench: {
    runId: string;
    split: string;
    date: string;
    /** Accuracy per mode, 0..1. */
    accuracy: Record<string, number>;
  } | null;
}

export async function statsDocument(
  db: Queryable,
  namespace: { id: string; slug: string },
  reportsDir: string | null,
): Promise<StatsDocument> {
  const s = await namespaceStats(db, namespace.id);
  const bench = latestBenchSummary(reportsDir);
  return {
    namespace: namespace.slug,
    facts: { ...s.facts, adHocRate: Math.round(s.facts.adHocRate * 1000) / 1000 },
    episodes: s.episodes,
    entities: s.entities,
    lastSweep: s.lastSweep ? iso(s.lastSweep) : null,
    bench: bench && {
      runId: bench.runId,
      split: bench.split,
      date: bench.date,
      accuracy: Object.fromEntries(
        Object.entries(bench.modes)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([mode, m]) => [mode, m.accuracy]),
      ),
    },
  };
}
