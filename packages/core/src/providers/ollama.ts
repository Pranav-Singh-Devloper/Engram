// A local model through Ollama's /api/chat, with no SDK dependency. Same
// prompts as Gemini (PromptedProvider). The JSON schema goes in `format`,
// where Ollama constrains decoding, and the zod check still decides.
// Embeddings come from an injected provider (Gemini): the engine's vectors
// must all live in one embedding space.
//
// Replies stream as NDJSON: Node's fetch gives up on response headers after
// 300 s, and a long local generation sends nothing until it's done otherwise.
import { z } from 'zod';
import type { EmbedPurpose } from './contracts.js';
import { defaultHttpDeps, postJson } from './http.js';
import type { HttpDeps, RetryOptions } from './http.js';
import { PromptedProvider } from './prompted.js';
import type { Provider } from './provider.js';
import { ProviderOutputError } from './provider.js';
import type { ChatSend } from './structured.js';

export const OLLAMA_BASE_URL = 'http://localhost:11434';
export const DEFAULT_OLLAMA_MODEL = 'qwen3.5:9b';

export interface OllamaOptions {
  model?: string;
  baseUrl?: string;
  /** Where embeddings come from; the engine's vectors must share one space. */
  embedder: Pick<Provider, 'embed'>;
  /** Context window. 32k fits a 20k-token packed session plus the reply. */
  numCtx?: number;
  /** Fixed, so runs are repeatable (and cacheable) at temperature 0. */
  seed?: number;
  retry?: Partial<RetryOptions>;
  http?: Partial<HttpDeps>;
}

/** A local server fails fast or not at all; long backoff only hides a stopped server. */
const LOCAL_RETRY: RetryOptions = { maxRetries: 2, baseDelayMs: 500, maxDelayMs: 5_000 };

const StreamLine = z.object({
  message: z.object({ content: z.string().optional() }).optional(),
  done: z.boolean().optional(),
  error: z.string().optional(),
});

/** Joins a streamed /api/chat reply. Exported for tests. */
export function readChatStream(ndjson: string): string {
  let text = '';
  let done = false;
  for (const line of ndjson.split('\n')) {
    if (line.trim() === '') continue;
    const parsed = StreamLine.safeParse(JSON.parse(line));
    if (!parsed.success)
      throw new ProviderOutputError('Unexpected Ollama stream line', line.slice(0, 500));
    if (parsed.data.error)
      throw new ProviderOutputError(`Ollama: ${parsed.data.error}`, line.slice(0, 500));
    text += parsed.data.message?.content ?? '';
    if (parsed.data.done) done = true;
  }
  if (!done) throw new ProviderOutputError('Ollama stream ended before done', ndjson.slice(-500));
  if (text === '') throw new ProviderOutputError('Empty Ollama reply', ndjson.slice(-500));
  return text;
}

export class OllamaProvider extends PromptedProvider {
  readonly name = 'ollama';
  readonly model: string;
  private readonly baseUrl: string;
  private readonly retry: RetryOptions;
  private readonly deps: HttpDeps;

  constructor(private readonly options: OllamaOptions) {
    super();
    this.model = options.model ?? DEFAULT_OLLAMA_MODEL;
    this.baseUrl = options.baseUrl ?? OLLAMA_BASE_URL;
    this.retry = { ...LOCAL_RETRY, ...options.retry };
    this.deps = { ...defaultHttpDeps, ...options.http };
  }

  embed(texts: readonly string[], options: { purpose: EmbedPurpose }): Promise<number[][]> {
    return this.options.embedder.embed(texts, options);
  }

  protected chat(): ChatSend {
    return async ({ system, turns, jsonSchema, temperature }) => {
      const reply = await postJson(
        `${this.baseUrl}/api/chat`,
        {
          model: this.model,
          messages: [
            { role: 'system', content: system },
            ...turns.map((t) => ({
              role: t.role === 'model' ? 'assistant' : 'user',
              content: t.text,
            })),
          ],
          format: jsonSchema ?? 'json',
          stream: true,
          // Thinking tokens cost minutes locally and add nothing to extraction.
          think: false,
          options: {
            temperature,
            seed: this.options.seed ?? 42,
            num_ctx: this.options.numCtx ?? 32_768,
          },
        },
        {
          headers: {},
          retry: this.retry,
          deps: this.deps,
          parse: async (res) => readChatStream(await res.text()),
        },
      );
      return reply as string;
    };
  }
}
