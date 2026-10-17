// Gemini over its REST API with plain fetch; no SDK dependency.
// Embeddings use gemini-embedding-2, which takes task prefixes instead of a
// taskType field and is truncated to 768 dims via outputDimensionality.
// The structured methods' prompts and validation live in PromptedProvider;
// this class supplies the transport, key failover and embeddings.
import { z } from 'zod';
import { EMBEDDING_DIM } from '../config/index.js';
import { assertVector, l2Normalize } from '../db/vector.js';
import type { EmbedPurpose } from './contracts.js';
import { DEFAULT_RETRY, defaultHttpDeps, postJson } from './http.js';
import type { HttpDeps, RetryOptions } from './http.js';
import { ProviderError, ProviderHttpError, ProviderOutputError } from './provider.js';
import { PromptedProvider } from './prompted.js';
import { geminiChat } from './structured.js';
import type { ChatSend } from './structured.js';

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_EMBED_MODEL = 'gemini-embedding-2';

/** batchEmbedContents accepts at most 100 requests per call. */
const EMBED_BATCH = 100;

export interface GeminiOptions {
  apiKey: string;
  /**
   * Keys from other accounts. Free quotas are per Google Cloud project, so
   * when a key's quota is exhausted the provider moves to the next one and
   * stays there.
   */
  fallbackApiKeys?: readonly string[];
  /** Told when the provider moves to the next key (never given the key itself). */
  onKeySwitch?: (toIndex: number, reason: string) => void;
  embedModel?: string;
  /** Required by the structured methods; unused by `embed`. */
  chatModel?: string;
  baseUrl?: string;
  retry?: Partial<RetryOptions>;
  http?: Partial<HttpDeps>;
}

const BatchEmbedResponse = z.object({
  embeddings: z.array(z.object({ values: z.array(z.number()) })),
});

/**
 * The main key and any fallbacks from the environment: GEMINI_API_KEY, then
 * GEMINI_API_KEY_FALLBACK (comma-separated). Keys from other accounts have
 * their own free quotas, since limits are per Google Cloud project.
 */
export function geminiKeysFromEnv(env: Record<string, string | undefined>): {
  apiKey: string;
  fallbackApiKeys: string[];
} {
  return {
    apiKey: env.GEMINI_API_KEY ?? '',
    fallbackApiKeys: (env.GEMINI_API_KEY_FALLBACK ?? '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean),
  };
}

/**
 * gemini-embedding-2 reads at most 8,192 tokens. Longer texts (pasted
 * documents in LongMemEval turns) are cut to their start: ~24k characters is
 * ~6k tokens, leaving room for multilingual text and the task prefix.
 */
export const EMBED_MAX_CHARS = 24_000;

/** gemini-embedding-2's documented task prefixes. */
export function embedText(text: string, purpose: EmbedPurpose): string {
  const body = text.length > EMBED_MAX_CHARS ? text.slice(0, EMBED_MAX_CHARS) : text;
  return purpose === 'query'
    ? `task: search result | query: ${body}`
    : `title: none | text: ${body}`;
}

export class GeminiProvider extends PromptedProvider {
  readonly name = 'gemini';
  private readonly embedModel: string;
  private readonly baseUrl: string;
  private readonly retry: RetryOptions;
  private readonly deps: HttpDeps;
  private readonly keys: string[];
  private keyIndex = 0;

  constructor(private readonly options: GeminiOptions) {
    super();
    if (!options.apiKey) throw new ProviderError('GEMINI_API_KEY is not set.');
    this.embedModel = options.embedModel ?? DEFAULT_EMBED_MODEL;
    this.baseUrl = options.baseUrl ?? GEMINI_BASE_URL;
    this.retry = { ...DEFAULT_RETRY, ...options.retry };
    this.deps = { ...defaultHttpDeps, ...options.http };
    this.keys = [options.apiKey, ...(options.fallbackApiKeys ?? []).filter(Boolean)];
  }

  /** Which key is in use: 0 for the main key, 1+ for fallbacks. */
  get activeKey(): number {
    return this.keyIndex;
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    for (;;) {
      try {
        return await postJson(`${this.baseUrl}/${path}`, body, {
          headers: { 'x-goog-api-key': this.keys[this.keyIndex] ?? '' },
          retry: this.retry,
          deps: this.deps,
        });
      } catch (err) {
        // Move on when this key can't serve requests today: its quota is
        // exhausted, or its project has been denied access (403).
        const unusable =
          err instanceof ProviderHttpError && (err.quotaExhausted || err.status === 403);
        if (!unusable || this.keyIndex >= this.keys.length - 1) throw err;
        this.keyIndex++;
        this.options.onKeySwitch?.(this.keyIndex, err.message.slice(0, 120));
      }
    }
  }

  async embed(texts: readonly string[], options: { purpose: EmbedPurpose }): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const batch = texts.slice(i, i + EMBED_BATCH);
      const json = await this.post(`models/${this.embedModel}:batchEmbedContents`, {
        requests: batch.map((text) => ({
          model: `models/${this.embedModel}`,
          content: { parts: [{ text: embedText(text, options.purpose) }] },
          outputDimensionality: EMBEDDING_DIM,
        })),
      });
      const parsed = BatchEmbedResponse.safeParse(json);
      if (!parsed.success || parsed.data.embeddings.length !== batch.length) {
        throw new ProviderOutputError(
          `Unexpected batchEmbedContents response for ${batch.length} texts`,
          JSON.stringify(json).slice(0, 500),
        );
      }
      for (const { values } of parsed.data.embeddings) {
        // The model normalizes truncated outputs itself; renormalizing is cheap insurance.
        const v = l2Normalize(values);
        assertVector(v);
        vectors.push(v);
      }
    }
    return vectors;
  }

  protected chat(): ChatSend | Error {
    const model = this.options.chatModel;
    if (!model) return new ProviderError('No Gemini chat model configured.');
    return geminiChat((body) => this.post(`models/${model}:generateContent`, body));
  }
}
