// A local model through Ollama's /api/chat, with no SDK dependency. Same
// prompts as Gemini (PromptedProvider). The JSON schema goes in `format`,
// where Ollama constrains decoding. Some models can't be constrained (Ollama
// answers 501 "structured output is unavailable", as for qwen3.5); the schema
// then goes into the system prompt instead. Either way the zod check decides.
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
import { ProviderHttpError, ProviderOutputError } from './provider.js';
import type { ChatSend } from './structured.js';

export const OLLAMA_BASE_URL = 'http://localhost:11434';
export const DEFAULT_OLLAMA_MODEL = 'qwen3.5:9b';

export interface OllamaOptions {
  model?: string;
  baseUrl?: string;
  /** Where embeddings come from: Gemini, or a local OllamaEmbedder. */
  embedder: Pick<Provider, 'embed' | 'embeddingSpace'>;
  /** Context window. 32k fits a 20k-token packed session plus the reply. */
  numCtx?: number;
  /** Fixed, so runs are repeatable (and cacheable) at temperature 0. */
  seed?: number;
  /**
   * 'format': constrained decoding. 'prompt': the schema rides in the system
   * prompt. Default: try 'format', and switch for good on a 501.
   */
  structured?: 'format' | 'prompt';
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

/** The JSON object in a reply that may be fenced or padded. Exported for tests. */
export function jsonPart(text: string): string {
  const unfenced = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  return start >= 0 && end > start ? unfenced.slice(start, end + 1) : unfenced.trim();
}

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
  private structured: 'format' | 'prompt' | 'auto';

  constructor(private readonly options: OllamaOptions) {
    super();
    this.structured = options.structured ?? 'auto';
    this.model = options.model ?? DEFAULT_OLLAMA_MODEL;
    this.baseUrl = options.baseUrl ?? OLLAMA_BASE_URL;
    this.retry = { ...LOCAL_RETRY, ...options.retry };
    this.deps = { ...defaultHttpDeps, ...options.http };
  }

  embed(texts: readonly string[], options: { purpose: EmbedPurpose }): Promise<number[][]> {
    return this.options.embedder.embed(texts, options);
  }

  embeddingSpace(): Promise<string> {
    return this.options.embedder.embeddingSpace();
  }

  /** How structured replies are being obtained (after any automatic switch). */
  get structuredMode(): 'format' | 'prompt' | 'auto' {
    return this.structured;
  }

  protected chat(): ChatSend {
    return async (request) => {
      if (this.structured !== 'prompt') {
        try {
          return await this.send(request, true);
        } catch (err) {
          const unsupported =
            err instanceof ProviderHttpError &&
            err.status === 501 &&
            /structured output/i.test(err.message);
          if (!unsupported || this.structured === 'format') throw err;
          this.structured = 'prompt';
        }
      }
      return jsonPart(await this.send(request, false));
    };
  }

  private async send(
    { system, turns, jsonSchema, temperature }: Parameters<ChatSend>[0],
    constrained: boolean,
  ): Promise<string> {
    const schemaNote =
      !constrained && jsonSchema
        ? `\n\nReply with one JSON object, no prose and no code fences, matching this JSON Schema exactly:\n${JSON.stringify(jsonSchema)}`
        : '';
    const reply = await postJson(
      `${this.baseUrl}/api/chat`,
      {
        model: this.model,
        messages: [
          { role: 'system', content: system + schemaNote },
          ...turns.map((t) => ({
            role: t.role === 'model' ? 'assistant' : 'user',
            content: t.text,
          })),
        ],
        ...(constrained && { format: jsonSchema ?? 'json' }),
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
  }
}
