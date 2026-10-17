// Gemini over its REST API with plain fetch; no SDK dependency.
// Embeddings use gemini-embedding-2, which takes task prefixes instead of a
// taskType field and is truncated to 768 dims via outputDimensionality.
// Structured methods are added in the phases that write their prompts; the
// prompts and model-facing schemas live next to the code that uses the results.
import { z } from 'zod';
import { EMBEDDING_DIM } from '../config/index.js';
import { assertVector, l2Normalize } from '../db/vector.js';
import {
  DISAMBIGUATE_SYSTEM,
  PROCESS_EPISODE_SYSTEM,
  WireDisambiguate,
  WireProcessEpisode,
  disambiguateUser,
  jsonSchemaFor,
  processEpisodeUser,
} from '../extract/prompt.js';
import { ADJUDICATE_SYSTEM, WireAdjudicate, adjudicateUser } from '../conflict/prompt.js';
import { COMPOSE_SYSTEM, WireCompose, composeUser, normalizeCompose } from '../compose/prompt.js';
import {
  AdjudicateInput,
  ComposeInput,
  DisambiguateInput,
  ProcessEpisodeInput,
} from './contracts.js';
import type { EmbedPurpose, MethodInput, MethodOutput, StructuredMethod } from './contracts.js';
import { aliasIds } from './aliases.js';
import { DEFAULT_RETRY, defaultHttpDeps, postJson } from './http.js';
import type { HttpDeps, RetryOptions } from './http.js';
import type { Provider } from './provider.js';
import { ProviderError, ProviderHttpError, ProviderOutputError } from './provider.js';
import { generateStructured } from './structured.js';
import type { StructuredRequest } from './structured.js';

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_EMBED_MODEL = 'gemini-embedding-2';

const PROCESS_EPISODE_JSON_SCHEMA = jsonSchemaFor(WireProcessEpisode);
const DISAMBIGUATE_JSON_SCHEMA = jsonSchemaFor(WireDisambiguate);
const ADJUDICATE_JSON_SCHEMA = jsonSchemaFor(WireAdjudicate);
const COMPOSE_JSON_SCHEMA = jsonSchemaFor(WireCompose);

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

/** gemini-embedding-2's documented task prefixes. */
export function embedText(text: string, purpose: EmbedPurpose): string {
  return purpose === 'query'
    ? `task: search result | query: ${text}`
    : `title: none | text: ${text}`;
}

export class GeminiProvider implements Provider {
  readonly name = 'gemini';
  private readonly embedModel: string;
  private readonly baseUrl: string;
  private readonly retry: RetryOptions;
  private readonly deps: HttpDeps;
  private readonly keys: string[];
  private keyIndex = 0;

  constructor(private readonly options: GeminiOptions) {
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

  /** JSON generation with zod validation and one repair attempt. Used by structured methods. */
  generate<T>(request: StructuredRequest<T>): Promise<T> {
    const model = this.options.chatModel;
    if (!model) return Promise.reject(new ProviderError('No Gemini chat model configured.'));
    return generateStructured(
      (body) => this.post(`models/${model}:generateContent`, body),
      request,
    );
  }

  private notYet<M extends StructuredMethod>(method: M, where: string): Promise<MethodOutput<M>> {
    return Promise.reject(new ProviderError(`GeminiProvider.${method}: see ${where}.`));
  }

  processEpisode = (input: MethodInput<'processEpisode'>) =>
    this.generate({
      system: PROCESS_EPISODE_SYSTEM,
      user: processEpisodeUser(ProcessEpisodeInput.parse(input)),
      schema: WireProcessEpisode,
      jsonSchema: PROCESS_EPISODE_JSON_SCHEMA,
    });

  adjudicate = async (input: MethodInput<'adjudicate'>) => {
    const parsed = AdjudicateInput.parse(input);
    const ids = aliasIds(
      parsed.existing.map((e) => e.id),
      'f',
    );
    const out = await this.generate({
      system: ADJUDICATE_SYSTEM,
      user: adjudicateUser({
        ...parsed,
        existing: parsed.existing.map((e) => ({ ...e, id: ids.label(e.id) })),
      }),
      schema: WireAdjudicate,
      jsonSchema: ADJUDICATE_JSON_SCHEMA,
    });
    return {
      ...out,
      targetFactId: out.targetFactId === null ? null : ids.resolve(out.targetFactId),
    };
  };

  disambiguate = async (input: MethodInput<'disambiguate'>) => {
    const parsed = DisambiguateInput.parse(input);
    const ids = aliasIds(
      parsed.candidates.map((c) => c.id),
      'c',
    );
    const out = await this.generate({
      system: DISAMBIGUATE_SYSTEM,
      user: disambiguateUser({
        ...parsed,
        candidates: parsed.candidates.map((c) => ({ ...c, id: ids.label(c.id) })),
      }),
      schema: WireDisambiguate,
      jsonSchema: DISAMBIGUATE_JSON_SCHEMA,
    });
    return { ...out, entityId: out.entityId === null ? null : ids.resolve(out.entityId) };
  };

  compose = async (input: MethodInput<'compose'>) => {
    const parsed = ComposeInput.parse(input);
    const ids = aliasIds(
      parsed.memories.map((m) => m.id),
      'm',
    );
    const out = await this.generate({
      system: COMPOSE_SYSTEM,
      user: composeUser({
        ...parsed,
        memories: parsed.memories.map((m) => ({ ...m, id: ids.label(m.id) })),
      }),
      schema: WireCompose,
      jsonSchema: COMPOSE_JSON_SCHEMA,
    });
    return normalizeCompose({ ...out, usedMemoryIds: out.usedMemoryIds.map(ids.resolve) }, parsed);
  };
  summarize = () => this.notYet('summarize', 'P06b');
  /** The bench judge runs on a different model family (GroqProvider). */
  judge = () => this.notYet('judge', 'GroqProvider');
}
