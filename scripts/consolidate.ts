// `pnpm jobs:consolidate`: one consolidation run (SPEC §8) against the local
// database, or the hosted one with --hosted (the nightly workflow). Prints the
// plan first; --estimate stops there, so it costs nothing.
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  config,
  consolidate,
  createDb,
  getNamespaceBySlug,
  pendingClusters,
  providerFromEnv,
} from '@engram/core';
import { parseConsolidateArgs } from './jobs.js';

const envFile = path.resolve(import.meta.dirname, '../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

async function main(): Promise<void> {
  const args = parseConsolidateArgs(process.argv.slice(2), process.env);
  // The session pooler or a direct connection: this is a long job (SPEC §14).
  const db = createDb(args.url, { max: 2 });
  try {
    let namespaceId: string | undefined;
    if (args.namespace) {
      const ns = await getNamespaceBySlug(db, args.namespace);
      if (!ns) throw new Error(`No namespace "${args.namespace}".`);
      namespaceId = ns.id;
    }

    const cfg = config.consolidation;
    const cap = args.maxClusters ?? cfg.maxClustersPerRun;
    const clusters = await pendingClusters(db, { namespaceId });
    const worth = clusters.filter((c) => c.maxImportance >= cfg.minImportance).length;
    const calls = Math.min(cap, worth);
    console.log(
      `${clusters.length} pending cluster(s): ${clusters.length - worth} skipped without a call, ` +
        `${calls} to summarize now${worth > calls ? `, ${worth - calls} left for later runs` : ''}.`,
    );
    console.log(
      `estimate: ${calls} summarize call(s), up to ${2 * calls + 1} embed call(s), ` +
        'plus an adjudication for any conflict the rules cannot settle.',
    );
    if (args.estimate || (calls === 0 && clusters.length === worth)) return;

    // ENGRAM_PROVIDER picks Gemini (needs GEMINI_API_KEY) or local Ollama (P08b).
    const provider = providerFromEnv(process.env, {
      onKeySwitch: (i, _reason, lane) => {
        console.error(`gemini ${lane}: key ${i - 1} is out of quota; now on key ${i}`);
      },
    });
    const started = Date.now();
    const r = await consolidate(db, provider, { namespaceId, maxClusters: cap });
    const outcomes = Object.entries(r.outcomes)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k} ${n}`)
      .join(', ');
    console.log(
      `summarized ${r.summarized}, skipped ${r.skipped}, remaining ${r.remaining}` +
        `${r.blocked > 0 ? `, refused ${r.blocked}` : ''}${r.failed > 0 ? `, failed ${r.failed}` : ''}; ` +
        `${r.candidates} candidate(s) (${outcomes || 'none'}), ${r.promoted} promoted to long_term; ` +
        `${r.reembedded} turn(s) re-embedded; ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
  } finally {
    await db.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
