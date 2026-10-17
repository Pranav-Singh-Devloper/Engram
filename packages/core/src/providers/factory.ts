// Every entry point builds its provider here (P08b): MCP stdio, jobs, the
// bench. ENGRAM_PROVIDER picks the engine's models:
//   gemini (default)  Gemini generation and embeddings (needs GEMINI_API_KEY)
//   ollama            local generation (OLLAMA_MODEL) and local embeddings
//                     (OLLAMA_EMBED_MODEL); no API key is read
// OLLAMA_EMBEDDINGS=gemini keeps Gemini embeddings under local generation
// (the bench ablation's row B).
import { GeminiProvider, geminiKeysFromEnv } from './gemini.js';
import type { HttpDeps, RetryOptions } from './http.js';
import { DEFAULT_OLLAMA_MODEL, OLLAMA_BASE_URL, OllamaProvider } from './ollama.js';
import { DEFAULT_OLLAMA_EMBED_MODEL, OllamaEmbedder } from './ollamaEmbed.js';
import type { Provider } from './provider.js';
import { ProviderError } from './provider.js';

export const PROVIDER_KINDS = ['gemini', 'ollama'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

type Env = Record<string, string | undefined>;

export function providerKind(env: Env): ProviderKind {
  const kind = env.ENGRAM_PROVIDER?.trim() || 'gemini';
  if (!(PROVIDER_KINDS as readonly string[]).includes(kind)) {
    throw new ProviderError(
      `ENGRAM_PROVIDER must be one of ${PROVIDER_KINDS.join(', ')}; got "${kind}".`,
    );
  }
  return kind as ProviderKind;
}

/** localhost, 127.0.0.0/8 or ::1. Ollama has no authentication, so remote use is opt-in. */
export function isLoopbackUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  return host === 'localhost' || host === '::1' || /^127\.\d+\.\d+\.\d+$/.test(host);
}

export interface FactoryOptions {
  /** Injected fetch (the bench's response cache) for every provider built. */
  http?: Partial<HttpDeps>;
  retry?: Partial<RetryOptions>;
  onKeySwitch?: (toIndex: number, reason: string) => void;
}

function gemini(env: Env, options: FactoryOptions): GeminiProvider {
  return new GeminiProvider({
    ...geminiKeysFromEnv(env),
    chatModel: env.GEMINI_CHAT_MODEL || 'gemini-3.5-flash-lite',
    embedModel: env.GEMINI_EMBED_MODEL || undefined,
    onKeySwitch: options.onKeySwitch,
    http: options.http,
    retry: options.retry,
  });
}

export function providerFromEnv(env: Env, options: FactoryOptions = {}): Provider {
  if (providerKind(env) === 'gemini') return gemini(env, options);

  const baseUrl = env.OLLAMA_BASE_URL?.trim() || OLLAMA_BASE_URL;
  if (!isLoopbackUrl(baseUrl) && env.OLLAMA_ALLOW_REMOTE !== '1') {
    throw new ProviderError(
      `OLLAMA_BASE_URL (${baseUrl}) is not a loopback address. Ollama has no authentication; set OLLAMA_ALLOW_REMOTE=1 only for a server you control.`,
    );
  }
  const embedder =
    env.OLLAMA_EMBEDDINGS === 'gemini'
      ? gemini(env, options)
      : new OllamaEmbedder({
          model: env.OLLAMA_EMBED_MODEL || DEFAULT_OLLAMA_EMBED_MODEL,
          baseUrl,
          http: options.http,
        });
  return new OllamaProvider({
    model: env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL,
    baseUrl,
    embedder,
    http: options.http,
  });
}
