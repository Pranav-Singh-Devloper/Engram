// `pnpm db:reembed --namespace=<slug> [--hosted]`: converts a namespace to the
// configured embedder's space (ENGRAM_PROVIDER / OLLAMA_EMBED_MODEL), e.g.
// after switching to local mode. One transaction; prints what it re-embedded.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createDb, getNamespaceBySlug, providerFromEnv, reembedNamespace } from '@engram/core';
import { jobDatabaseUrl } from './jobs.js';

const envFile = path.resolve(import.meta.dirname, '../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const slug = args.find((a) => a.startsWith('--namespace='))?.slice('--namespace='.length);
  if (!slug) throw new Error('Pass --namespace=<slug>.');
  const db = createDb(jobDatabaseUrl(args.includes('--hosted'), process.env), { max: 1 });
  try {
    const ns = await getNamespaceBySlug(db, slug);
    if (!ns) throw new Error(`No namespace "${slug}".`);
    const provider = providerFromEnv(process.env);
    const r = await reembedNamespace(db, provider, ns.id);
    console.log(
      `${slug}: ${ns.embeddingModel ?? 'unbound'} → ${r.space}; re-embedded ${r.episodes} episode(s), ${r.facts} fact(s), ${r.entities} entit${r.entities === 1 ? 'y' : 'ies'}`,
    );
  } finally {
    await db.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
