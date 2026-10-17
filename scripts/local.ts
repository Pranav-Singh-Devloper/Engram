// Local mode setup and diagnostics (P08b):
//   pnpm local:setup    check Ollama, pull the models (sizes stated first), smoke-test, print .env lines
//   pnpm local:doctor   the same checks without pulling, plus embedding spaces that no longer match
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, statfsSync } from 'node:fs';
import { freemem, totalmem } from 'node:os';
import path from 'node:path';
import {
  DEFAULT_DATABASE_URL,
  DEFAULT_OLLAMA_EMBED_MODEL,
  DEFAULT_OLLAMA_MODEL,
  OLLAMA_BASE_URL,
  createDb,
  providerFromEnv,
} from '@engram/core';

const envFile = path.resolve(import.meta.dirname, '../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const mode = process.argv[2] === 'setup' ? 'setup' : 'doctor';
const base = process.env.OLLAMA_BASE_URL || OLLAMA_BASE_URL;
const chatModel = process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
const embedModel = process.env.OLLAMA_EMBED_MODEL || DEFAULT_OLLAMA_EMBED_MODEL;
/** Download sizes as published (2026-10-18), stated before any pull. */
const KNOWN_GB: Record<string, number> = {
  'qwen3.5:9b': 7.6,
  'qwen3.5:4b': 4.0,
  'embeddinggemma:300m': 0.62,
  'nomic-embed-text:latest': 0.27,
};
const GB = 1024 ** 3;

let failures = 0;
const ok = (m: string) => {
  console.log(`  ✓ ${m}`);
};
const warn = (m: string) => {
  console.log(`  ! ${m}`);
};
const fail = (m: string, fix: string) => {
  failures++;
  console.log(`  ✗ ${m}\n    → ${fix}`);
};

const versionAtLeast = (v: string, min: string) => {
  const a = v.split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
};

async function json<T>(url: string): Promise<T | undefined> {
  try {
    const res = await fetch(url);
    return res.ok ? ((await res.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  console.log(`Engram local mode — ${mode}\n`);

  console.log('Ollama');
  const hasCli = spawnSync('ollama', ['--version'], { encoding: 'utf8' }).status === 0;
  if (!hasCli)
    fail(
      'ollama is not installed',
      'Install it from https://ollama.com/download (or `brew install ollama`).',
    );
  const version = await json<{ version: string }>(`${base}/api/version`);
  if (!version) {
    fail(
      `no Ollama server at ${base}`,
      'Start it: `ollama serve` (or `brew services start ollama`).',
    );
    return;
  }
  if (versionAtLeast(version.version, '0.22.0')) ok(`server ${version.version} at ${base}`);
  else fail(`server ${version.version} is too old for qwen3.5 (needs 0.22.0+)`, 'Upgrade Ollama.');

  console.log('\nModels');
  const tags =
    (await json<{ models: { name: string; digest: string; size: number }[] }>(`${base}/api/tags`))
      ?.models ?? [];
  for (const model of [chatModel, embedModel]) {
    const name = model.includes(':') ? model : `${model}:latest`;
    const found = tags.find((m) => m.name === name);
    if (found) {
      ok(`${name} (${(found.size / GB).toFixed(1)} GB, digest ${found.digest.slice(0, 12)})`);
      continue;
    }
    const size = KNOWN_GB[name];
    if (mode === 'setup') {
      console.log(`  … pulling ${name}${size ? ` (~${size} GB)` : ''}`);
      try {
        execFileSync('ollama', ['pull', name], { stdio: 'inherit' });
        ok(`${name} pulled`);
      } catch {
        fail(
          `couldn't pull ${name}`,
          'Check your connection and disk space, then rerun pnpm local:setup.',
        );
      }
    } else {
      fail(`${name} is not installed${size ? ` (~${size} GB)` : ''}`, 'Run `pnpm local:setup`.');
    }
  }

  console.log('\nMachine');
  const freeDisk = (() => {
    const s = statfsSync(path.resolve(import.meta.dirname, '..'));
    return (s.bavail * s.bsize) / GB;
  })();
  const ram = totalmem() / GB;
  if (freeDisk > 2) ok(`${freeDisk.toFixed(1)} GB free disk`);
  else warn(`only ${freeDisk.toFixed(1)} GB free disk`);
  const needed = (KNOWN_GB[chatModel] ?? 8) + (KNOWN_GB[embedModel] ?? 1) + 2;
  if (ram >= needed + 4)
    ok(
      `${ram.toFixed(0)} GB RAM (${(freemem() / GB).toFixed(1)} GB free now; the models need ~${needed.toFixed(0)} GB)`,
    );
  else
    warn(
      `${ram.toFixed(0)} GB RAM; ${chatModel} plus ${embedModel} need ~${needed.toFixed(0)} GB. Try OLLAMA_MODEL=qwen3.5:4b.`,
    );

  console.log('\nSmoke test');
  const provider = providerFromEnv({ ...process.env, ENGRAM_PROVIDER: 'ollama' });
  try {
    const t = Date.now();
    const [v] = await provider.embed(['I live in Lisbon.'], { purpose: 'document' });
    ok(
      `embedding: ${v?.length ?? 0}-d in ${Date.now() - t} ms (space ${await provider.embeddingSpace()})`,
    );
  } catch (err) {
    fail(
      `embedding failed: ${String(err).slice(0, 160)}`,
      `Check ${embedModel} is a 768-d embedding model (embeddinggemma, nomic-embed-text).`,
    );
  }
  try {
    const t = Date.now();
    const out = await provider.processEpisode({
      content: 'My sister Ana lives in Porto.',
      role: 'user',
      occurredAt: new Date(),
      predicates: ['lives_in', 'sibling_of'],
    });
    ok(`extraction: ${out.candidates.length} fact(s) in ${((Date.now() - t) / 1000).toFixed(1)} s`);
  } catch (err) {
    fail(
      `extraction failed: ${String(err).slice(0, 160)}`,
      `Check ${chatModel} runs (\`ollama run ${chatModel}\`).`,
    );
  }

  if (mode === 'doctor') {
    console.log('\nEmbedding spaces');
    const db = createDb(process.env.DATABASE_URL || DEFAULT_DATABASE_URL, { max: 1 });
    try {
      const space = await provider.embeddingSpace();
      const rows = await db<{ slug: string; embeddingModel: string }[]>`
        select slug, embedding_model from namespaces where embedding_model is not null and embedding_model like ${`${embedModel.split(':')[0] ?? embedModel}%`}`;
      const stale = rows.filter((r) => r.embeddingModel !== space);
      if (stale.length === 0) ok(`every local namespace matches ${space}`);
      for (const r of stale) {
        fail(
          `${r.slug} was embedded with ${r.embeddingModel}, not ${space}`,
          `pnpm db:reembed --namespace=${r.slug}`,
        );
      }
    } catch {
      warn('database not reachable; skipped the embedding-space check');
    } finally {
      await db.end();
    }
  }

  if (mode === 'setup' && failures === 0) {
    console.log(
      `\nAdd to .env:\n  ENGRAM_PROVIDER=ollama\n  OLLAMA_MODEL=${chatModel}\n  OLLAMA_EMBED_MODEL=${embedModel}`,
    );
  }
  console.log(failures === 0 ? '\nAll good.' : `\n${failures} problem(s) found.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
