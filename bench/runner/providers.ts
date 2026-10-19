// Builds providers from the environment with the response cache and pacer in
// front of them. Shared by the dataset generator and the runner.
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_JUDGE_MODEL,
  DEFAULT_OLLAMA_EMBED_MODEL,
  DEFAULT_OLLAMA_MODEL,
  GeminiProvider,
  GroqProvider,
  OllamaEmbedder,
  OllamaProvider,
  withEmbedder,
  geminiKeysFromEnv,
} from '@engram/core';
import type { Provider } from '@engram/core';
import { UsageMeter, cachingFetch } from './cache.js';
import type { CacheMode } from './cache.js';
import { DEFAULT_RPM, Pacer } from './pacer.js';

export const BENCH_DIR = path.resolve(import.meta.dirname, '..');
export const DEFAULT_CACHE_DIR = path.join(BENCH_DIR, 'cache');

export function loadEnv(): void {
  const file = path.resolve(BENCH_DIR, '../.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

const rpm = (name: string, fallback: number) => Number(process.env[name] ?? fallback) || fallback;

export interface Providers {
  gemini: GeminiProvider;
  /** The system model under test: Gemini, or a local Ollama model (local or Gemini embeddings). */
  system: Provider;
  /** The system's embedder, for its truncation counter. */
  systemEmbedder: object;
  /** The system's generating provider, for its structured-output counters. */
  generator: object;
  judge: GroqProvider;
  verbalizer: (model: string) => GroqProvider;
  meter: UsageMeter;
}

export interface ProviderOptions {
  cacheDir?: string;
  mode?: CacheMode;
  /** Misses fall through to this cache before the network (recording the smoke subset). */
  fallbackCacheDir?: string;
  /** 'ollama' runs generation on a local model, free (OLLAMA_MODEL, default qwen3.5:9b). */
  system?: 'gemini' | 'ollama';
  /**
   * 'local' embeds with OLLAMA_EMBED_MODEL, 'gemini' with Gemini. The default
   * follows the system: local for 'ollama' (fully local; 'gemini' is the P08b
   * ablation's row B), Gemini for 'gemini' ('local' is LongMemEval's setup, ADR-018).
   */
  embeddings?: 'local' | 'gemini';
}

export function makeProviders(options: ProviderOptions = {}): Providers {
  const meter = new UsageMeter();
  const pacer = new Pacer({
    'gemini-generate': rpm('BENCH_RPM_GEMINI', DEFAULT_RPM['gemini-generate']),
    'gemini-embed': rpm('BENCH_RPM_EMBED', DEFAULT_RPM['gemini-embed']),
    groq: rpm('BENCH_RPM_GROQ', DEFAULT_RPM.groq),
  });
  const mode = options.mode ?? 'readwrite';
  const network = options.fallbackCacheDir
    ? cachingFetch({ dir: options.fallbackCacheDir, mode: 'readwrite', pacer })
    : undefined;
  const fetch = cachingFetch({
    dir: options.cacheDir ?? DEFAULT_CACHE_DIR,
    mode,
    missFile: path.join(BENCH_DIR, 'runs', 'last-miss.json'),
    meter,
    pacer: network ? undefined : pacer,
    fetch: network,
  });
  // Offline replays never need a real key; the cache answers or 404s.
  const key = (name: string) => process.env[name] || (mode === 'readonly' ? 'offline' : '');
  const http = { fetch };
  const groq = (model: string) => new GroqProvider({ apiKey: key('JUDGE_API_KEY'), model, http });
  const gemini = new GeminiProvider({
    ...geminiKeysFromEnv(process.env),
    apiKey: key('GEMINI_API_KEY'),
    onKeySwitch: (i, reason) => {
      console.error(
        `gemini: main key's quota is exhausted; switched to fallback key ${i} (${reason})`,
      );
    },
    embedModel: process.env.GEMINI_EMBED_MODEL || undefined,
    chatModel: process.env.GEMINI_CHAT_MODEL || 'gemini-3.5-flash-lite',
    http,
  });
  const local =
    (options.embeddings ?? (options.system === 'ollama' ? 'local' : 'gemini')) === 'local';
  const systemEmbedder = local
    ? new OllamaEmbedder({
        model: process.env.OLLAMA_EMBED_MODEL || DEFAULT_OLLAMA_EMBED_MODEL,
        http,
      })
    : gemini;
  const system: Provider =
    options.system === 'ollama'
      ? new OllamaProvider({
          model: process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL,
          embedder: systemEmbedder,
          http,
        })
      : local
        ? withEmbedder(gemini, systemEmbedder)
        : gemini;
  return {
    gemini,
    system,
    systemEmbedder,
    generator: options.system === 'ollama' ? system : gemini,
    judge: groq(process.env.JUDGE_MODEL || DEFAULT_JUDGE_MODEL),
    verbalizer: groq,
    meter,
  };
}
