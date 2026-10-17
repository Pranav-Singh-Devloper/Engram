// `pnpm jobs:consolidate`: one consolidation run (SPEC §8) against the local
// database, or the hosted one with --hosted (the nightly workflow). Prints the
// plan first; --estimate stops there, so it costs nothing.
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  GeminiProvider,
  config,
  consolidate,
  createDb,
  geminiKeysFromEnv,
  getNamespaceBySlug,
  pendingClusters,
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

    const model = process.env.GEMINI_CHAT_MODEL;
    const keys = geminiKeysFromEnv(process.env);
    if (calls > 0 && (!model || !keys.apiKey)) {
      throw new Error('Set GEMINI_API_KEY and GEMINI_CHAT_MODEL to consolidate.');
    }
    const provider = new GeminiProvider({
      ...keys,
      chatModel: model,
      embedModel: process.env.GEMINI_EMBED_MODEL || undefined,
      onKeySwitch: (i) => {
        console.error(`gemini: main key's quota is exhausted; switched to fallback key ${i}`);
      },
    });
    const started = Date.now();
    const r = await consolidate(db, provider, { namespaceId, maxClusters: cap });
    const outcomes = Object.entries(r.outcomes)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k} ${n}`)
      .join(', ');
    console.log(
      `summarized ${r.summarized}, skipped ${r.skipped}, remaining ${r.remaining}; ` +
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
