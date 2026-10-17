// Any OpenAI-compatible chat server (llama.cpp's llama-server, LM Studio,
// vLLM; P08b decision 1) on the shared prompts. The JSON schema goes in
// response_format; llama.cpp enforces it with grammar-constrained decoding,
// which sidesteps Ollama's missing structured output for qwen3.5. The zod
// check still decides. Embeddings come from an injected embedder.
import { z } from 'zod';
import type { EmbedPurpose } from './contracts.js';
import { defaultHttpDeps, postJson } from './http.js';
import type { HttpDeps, RetryOptions } from './http.js';
import { PromptedProvider } from './prompted.js';
import type { Provider } from './provider.js';
import { ProviderOutputError } from './provider.js';
import type { ChatSend } from './structured.js';

export interface OpenAICompatibleOptions {
  /** e.g. http://127.0.0.1:8091 (the /v1 prefix is added). */
  baseUrl: string;
  model: string;
  apiKey?: string;
  embedder: Pick<Provider, 'embed' | 'embeddingSpace'>;
  /** Hard cap on reply tokens for every structured call (decision 5). */
  maxTokens?: number;
  /** Extra request fields, e.g. llama.cpp's chat_template_kwargs to turn thinking off. */
  extra?: Record<string, unknown>;
  retry?: Partial<RetryOptions>;
  http?: Partial<HttpDeps>;
}

const Completion = z.object({
  choices: z.array(
    z.object({
      message: z.object({ content: z.string().nullable() }),
      finish_reason: z.string().nullable().optional(),
    }),
  ),
  usage: z.object({ completion_tokens: z.number().optional() }).optional(),
});

export class OpenAICompatibleProvider extends PromptedProvider {
  readonly name = 'openai-compatible';
  /** Replies cut off by maxTokens so far. */
  capped = 0;
  outputTokens = 0;
  private readonly retry: RetryOptions;
  private readonly deps: HttpDeps;

  constructor(private readonly options: OpenAICompatibleOptions) {
    super();
    this.retry = { maxRetries: 2, baseDelayMs: 500, maxDelayMs: 5_000, ...options.retry };
    this.deps = { ...defaultHttpDeps, ...options.http };
  }

  embed(texts: readonly string[], options: { purpose: EmbedPurpose }): Promise<number[][]> {
    return this.options.embedder.embed(texts, options);
  }

  embeddingSpace(): Promise<string> {
    return this.options.embedder.embeddingSpace();
  }

  protected chat(): ChatSend {
    return async ({ system, turns, jsonSchema, temperature }) => {
      const json = await postJson(
        `${this.options.baseUrl.replace(/\/$/, '')}/v1/chat/completions`,
        {
          model: this.options.model,
          messages: [
            { role: 'system', content: system },
            ...turns.map((t) => ({
              role: t.role === 'model' ? 'assistant' : 'user',
              content: t.text,
            })),
          ],
          ...(jsonSchema && {
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'reply', schema: jsonSchema, strict: true },
            },
          }),
          temperature,
          ...(this.options.maxTokens && { max_tokens: this.options.maxTokens }),
          ...this.options.extra,
        },
        {
          headers: this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {},
          retry: this.retry,
          deps: this.deps,
        },
      );
      const parsed = Completion.safeParse(json);
      const choice = parsed.success ? parsed.data.choices[0] : undefined;
      if (!parsed.success || !choice?.message.content) {
        throw new ProviderOutputError(
          'Unexpected chat completion',
          JSON.stringify(json).slice(0, 500),
        );
      }
      this.outputTokens += parsed.data.usage?.completion_tokens ?? 0;
      if (choice.finish_reason === 'length') this.capped++;
      return choice.message.content;
    };
  }
}
