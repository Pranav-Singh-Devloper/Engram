// Every entry point builds its provider here (P08b): MCP stdio, jobs, the
// bench. ENGRAM_PROVIDER picks the engine's models:
//   gemini (default)  Gemini generation and embeddings (needs GEMINI_API_KEY)
//   ollama            local generation (OLLAMA_MODEL) and local embeddings
//                     (OLLAMA_EMBED_MODEL); no API key is read
//   openai-compatible generation on any /v1/chat/completions server
//                     (OPENAI_COMPAT_BASE_URL, OPENAI_COMPAT_MODEL): llama.cpp,
//                     LM Studio, vLLM. Embeddings stay local through Ollama.
// OLLAMA_EMBEDDINGS=gemini keeps Gemini embeddings under local generation
// (the bench ablation's row B).
import { GeminiProvider, geminiKeysFromEnv } from './gemini.js';
import type { KeyLane } from './gemini.js';
import type { HttpDeps, RetryOptions } from './http.js';
import {
  DEFAULT_LOCAL_MAX_TOKENS,
  DEFAULT_OLLAMA_MODEL,
  OLLAMA_BASE_URL,
  OllamaProvider,
} from './ollama.js';
import { DEFAULT_OLLAMA_EMBED_MODEL, OllamaEmbedder } from './ollamaEmbed.js';
import { OpenAICompatibleProvider } from './openaiCompat.js';
import type { Provider } from './provider.js';
import { ProviderError } from './provider.js';

export const PROVIDER_KINDS = ['gemini', 'ollama', 'openai-compatible'] as const;
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
  onKeySwitch?: (toIndex: number, reason: string, lane: KeyLane) => void;
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

function requireLoopback(url: string, optIn: string | undefined, name: string, optInName: string) {
  if (!isLoopbackUrl(url) && optIn !== '1') {
    throw new ProviderError(
      `${name} (${url}) is not a loopback address, so memory content would leave this machine. Set ${optInName}=1 only for a server you control.`,
    );
  }
}

export function providerFromEnv(env: Env, options: FactoryOptions = {}): Provider {
  const kind = providerKind(env);
  if (kind === 'gemini') return gemini(env, options);

  const baseUrl = env.OLLAMA_BASE_URL?.trim() || OLLAMA_BASE_URL;
  requireLoopback(baseUrl, env.OLLAMA_ALLOW_REMOTE, 'OLLAMA_BASE_URL', 'OLLAMA_ALLOW_REMOTE');
  const embedder =
    env.OLLAMA_EMBEDDINGS === 'gemini'
      ? gemini(env, options)
      : new OllamaEmbedder({
          model: env.OLLAMA_EMBED_MODEL || DEFAULT_OLLAMA_EMBED_MODEL,
          baseUrl,
          http: options.http,
        });
  if (kind === 'openai-compatible') {
    const url = env.OPENAI_COMPAT_BASE_URL?.trim();
    const model = env.OPENAI_COMPAT_MODEL?.trim();
    if (!url || !model) {
      throw new ProviderError(
        'openai-compatible needs OPENAI_COMPAT_BASE_URL and OPENAI_COMPAT_MODEL.',
      );
    }
    requireLoopback(
      url,
      env.OPENAI_COMPAT_ALLOW_REMOTE,
      'OPENAI_COMPAT_BASE_URL',
      'OPENAI_COMPAT_ALLOW_REMOTE',
    );
    return new OpenAICompatibleProvider({
      baseUrl: url,
      model,
      apiKey: env.OPENAI_COMPAT_API_KEY || undefined,
      embedder,
      maxTokens: env.OPENAI_COMPAT_MAX_TOKENS
        ? Number(env.OPENAI_COMPAT_MAX_TOKENS)
        : DEFAULT_LOCAL_MAX_TOKENS,
      // llama.cpp reads this; other servers ignore unknown fields.
      extra: { chat_template_kwargs: { enable_thinking: false } },
      http: options.http,
    });
  }
  return new OllamaProvider({
    model: env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL,
    baseUrl,
    embedder,
    http: options.http,
  });
}
