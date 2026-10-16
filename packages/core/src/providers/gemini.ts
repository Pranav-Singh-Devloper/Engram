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
import { DisambiguateInput, ProcessEpisodeInput } from './contracts.js';
import type { EmbedPurpose, MethodInput, MethodOutput, StructuredMethod } from './contracts.js';
import { DEFAULT_RETRY, defaultHttpDeps, postJson } from './http.js';
import type { HttpDeps, RetryOptions } from './http.js';
import type { Provider } from './provider.js';
import { ProviderError, ProviderOutputError } from './provider.js';
import { generateStructured } from './structured.js';
import type { StructuredRequest } from './structured.js';

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_EMBED_MODEL = 'gemini-embedding-2';

const PROCESS_EPISODE_JSON_SCHEMA = jsonSchemaFor(WireProcessEpisode);
const DISAMBIGUATE_JSON_SCHEMA = jsonSchemaFor(WireDisambiguate);

/** batchEmbedContents accepts at most 100 requests per call. */
const EMBED_BATCH = 100;

export interface GeminiOptions {
  apiKey: string;
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

  constructor(private readonly options: GeminiOptions) {
    if (!options.apiKey) throw new ProviderError('GEMINI_API_KEY is not set.');
    this.embedModel = options.embedModel ?? DEFAULT_EMBED_MODEL;
    this.baseUrl = options.baseUrl ?? GEMINI_BASE_URL;
    this.retry = { ...DEFAULT_RETRY, ...options.retry };
    this.deps = { ...defaultHttpDeps, ...options.http };
  }

  private post(path: string, body: unknown): Promise<unknown> {
    return postJson(`${this.baseUrl}/${path}`, body, {
      headers: { 'x-goog-api-key': this.options.apiKey },
      retry: this.retry,
      deps: this.deps,
    });
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

  private notYet<M extends StructuredMethod>(method: M, phase: string): Promise<MethodOutput<M>> {
    return Promise.reject(new ProviderError(`GeminiProvider.${method} lands in ${phase}.`));
  }

  processEpisode = (input: MethodInput<'processEpisode'>) =>
    this.generate({
      system: PROCESS_EPISODE_SYSTEM,
      user: processEpisodeUser(ProcessEpisodeInput.parse(input)),
      schema: WireProcessEpisode,
      jsonSchema: PROCESS_EPISODE_JSON_SCHEMA,
    });

  disambiguate = (input: MethodInput<'disambiguate'>) =>
    this.generate({
      system: DISAMBIGUATE_SYSTEM,
      user: disambiguateUser(DisambiguateInput.parse(input)),
      schema: WireDisambiguate,
      jsonSchema: DISAMBIGUATE_JSON_SCHEMA,
    });

  adjudicate = () => this.notYet('adjudicate', 'P03');
  compose = () => this.notYet('compose', 'P04');
  summarize = () => this.notYet('summarize', 'P06b');
  judge = () => this.notYet('judge', 'P04');
}
