// Local embeddings through Ollama's /api/embed (P08b). embeddinggemma is
// 768-d natively and uses gemini-embedding-2's task prefixes, so embedText is
// shared. Its input limit is 2K tokens, so texts are capped at ~7k characters
// and every cap is counted (the bench reports a truncation rate; chunking
// long turns is P11). The space is name@digest: a tag can move to new weights.
import { z } from 'zod';
import { EMBEDDING_DIM } from '../config/index.js';
import { assertVector, l2Normalize } from '../db/vector.js';
import type { EmbedPurpose } from './contracts.js';
import { embedText } from './gemini.js';
import { defaultHttpDeps, postJson } from './http.js';
import type { HttpDeps, RetryOptions } from './http.js';
import { ProviderError, ProviderOutputError } from './provider.js';

export const DEFAULT_OLLAMA_EMBED_MODEL = 'embeddinggemma:300m';
/** ~1.75k tokens: inside embeddinggemma's 2K with room for the task prefix. */
export const LOCAL_EMBED_MAX_CHARS = 7_000;
const BATCH = 64;

export interface OllamaEmbedderOptions {
  model?: string;
  baseUrl?: string;
  maxChars?: number;
  retry?: Partial<RetryOptions>;
  http?: Partial<HttpDeps>;
}

const EmbedResponse = z.object({ embeddings: z.array(z.array(z.number())) });
const Tags = z.object({ models: z.array(z.object({ name: z.string(), digest: z.string() })) });

export class OllamaEmbedder {
  readonly model: string;
  /** Texts cut to maxChars so far. */
  truncated = 0;
  private readonly baseUrl: string;
  private readonly maxChars: number;
  private readonly retry: RetryOptions;
  private readonly deps: HttpDeps;
  private space: Promise<string> | undefined;

  constructor(options: OllamaEmbedderOptions = {}) {
    this.model = options.model ?? DEFAULT_OLLAMA_EMBED_MODEL;
    this.baseUrl = options.baseUrl ?? 'http://localhost:11434';
    this.maxChars = options.maxChars ?? LOCAL_EMBED_MAX_CHARS;
    this.retry = { maxRetries: 2, baseDelayMs: 500, maxDelayMs: 5_000, ...options.retry };
    this.deps = { ...defaultHttpDeps, ...options.http };
  }

  async embed(texts: readonly string[], options: { purpose: EmbedPurpose }): Promise<number[][]> {
    this.truncated += texts.filter((t) => t.length > this.maxChars).length;
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const batch = texts.slice(i, i + BATCH);
      const json = await postJson(
        `${this.baseUrl}/api/embed`,
        {
          model: this.model,
          input: batch.map((t) => embedText(t, options.purpose, this.maxChars)),
          truncate: true,
        },
        { headers: {}, retry: this.retry, deps: this.deps },
      );
      const parsed = EmbedResponse.safeParse(json);
      if (!parsed.success || parsed.data.embeddings.length !== batch.length) {
        throw new ProviderOutputError(
          `Unexpected /api/embed response for ${batch.length} texts`,
          JSON.stringify(json).slice(0, 500),
        );
      }
      for (const values of parsed.data.embeddings) {
        if (values.length !== EMBEDDING_DIM) {
          throw new ProviderError(
            `${this.model} returned ${values.length}-d vectors; the schema stores ${EMBEDDING_DIM}. Use a ${EMBEDDING_DIM}-d embedding model (embeddinggemma, nomic-embed-text).`,
          );
        }
        const v = l2Normalize(values);
        assertVector(v);
        out.push(v);
      }
    }
    return out;
  }

  /** name@digest, read once from /api/tags. */
  embeddingSpace(): Promise<string> {
    this.space ??= this.readDigest().catch((err: unknown) => {
      this.space = undefined;
      throw err;
    });
    return this.space;
  }

  private async readDigest(): Promise<string> {
    const res = await this.deps.fetch(`${this.baseUrl}/api/tags`, { method: 'GET' });
    if (!res.ok) throw new ProviderError(`Ollama /api/tags returned HTTP ${res.status}`);
    const tags = Tags.parse(await res.json());
    const name = this.model.includes(':') ? this.model : `${this.model}:latest`;
    const found = tags.models.find((m) => m.name === name);
    if (!found)
      throw new ProviderError(`Ollama has no model ${name}; run \`ollama pull ${name}\`.`);
    return `${name}@${found.digest.slice(0, 12)}`;
  }
}
