// An HTTP response cache in front of the providers (P04 design decision 4).
// It is an injectable `fetch`, keyed by sha256(url + request body), one JSON
// file per response. API keys travel in headers, which are never part of the
// key or the stored entry. Identical prompts (personas shared across items,
// re-runs with unchanged prompts) are answered from disk.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Pacer } from './pacer.js';

export type CacheMode = 'readwrite' | 'readonly' | 'off';

export interface Usage {
  /** Requests that went to the network. */
  calls: number;
  /** Requests answered from the cache. */
  cached: number;
  promptTokens: number;
  outputTokens: number;
}

export const emptyUsage = (): Usage => ({ calls: 0, cached: 0, promptTokens: 0, outputTokens: 0 });

/** Accumulates usage; the runner reads and resets it per item. */
export class UsageMeter {
  private usage = emptyUsage();

  take(): Usage {
    const u = this.usage;
    this.usage = emptyUsage();
    return u;
  }

  record(delta: Partial<Usage>): void {
    for (const k of Object.keys(delta) as (keyof Usage)[]) this.usage[k] += delta[k] ?? 0;
  }
}

/** Token counts from a Gemini or Groq response body, when present. */
export function tokensOf(json: unknown): { promptTokens: number; outputTokens: number } {
  const j = json as {
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    promptTokens: j.usageMetadata?.promptTokenCount ?? j.usage?.prompt_tokens ?? 0,
    outputTokens: j.usageMetadata?.candidatesTokenCount ?? j.usage?.completion_tokens ?? 0,
  };
}

/** Rounds embedding values so entries stay small; vectors are renormalized on read anyway. */
export function compact(json: unknown): unknown {
  const j = json as { embeddings?: { values?: number[] }[] };
  if (!Array.isArray(j.embeddings)) return json;
  return {
    ...j,
    embeddings: j.embeddings.map((e) => ({
      ...e,
      values: e.values?.map((v) => Math.round(v * 1e6) / 1e6),
    })),
  };
}

/** Token counts from the final line of an Ollama /api/chat stream. */
export function streamTokens(ndjson: string): { promptTokens: number; outputTokens: number } {
  const last = ndjson.trim().split('\n').at(-1) ?? '';
  try {
    const done = JSON.parse(last) as { prompt_eval_count?: number; eval_count?: number };
    return { promptTokens: done.prompt_eval_count ?? 0, outputTokens: done.eval_count ?? 0 };
  } catch {
    return { promptTokens: 0, outputTokens: 0 };
  }
}

export function cacheKey(url: string, body: string): string {
  return createHash('sha256').update(`${url}\n${body}`).digest('hex');
}

export interface CachingFetchOptions {
  dir: string;
  mode: CacheMode;
  meter?: UsageMeter;
  pacer?: Pacer;
  fetch?: typeof fetch;
  /** Read-only mode: where to write the last request that missed. */
  missFile?: string;
}

export function cachingFetch(options: CachingFetchOptions): typeof fetch {
  const real = options.fetch ?? fetch;
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = typeof init?.body === 'string' ? init.body : '';
    const key = cacheKey(url, body);
    const file = path.join(options.dir, key.slice(0, 2), `${key}.json`);

    if (options.mode !== 'off' && existsSync(file)) {
      options.meter?.record({ cached: 1 });
      const entry = JSON.parse(readFileSync(file, 'utf8')) as { body?: unknown; text?: string };
      // Streamed (NDJSON) replies are stored as text and replayed verbatim.
      return new Response(entry.text ?? JSON.stringify(entry.body), { status: 200 });
    }
    if (options.mode === 'readonly') {
      // Kept for debugging: which request had no recording, and why.
      if (options.missFile) {
        mkdirSync(path.dirname(options.missFile), { recursive: true });
        writeFileSync(
          options.missFile,
          `${JSON.stringify({ url, key, body: JSON.parse(body || 'null') as unknown }, null, 2)}\n`,
        );
      }
      // Not retryable: a miss is a missing recording, not a flaky network.
      return new Response(JSON.stringify({ error: `cache miss for ${url}` }), { status: 404 });
    }

    await options.pacer?.wait(url);
    const res = await real(input, init);
    if (!res.ok) return res;
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      // A local model's NDJSON stream: kept as text; its last line has the token counts.
      options.meter?.record({ calls: 1, ...streamTokens(text) });
      if (options.mode === 'readwrite') {
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, `${JSON.stringify({ url, text })}\n`);
      }
      return new Response(text, { status: res.status });
    }
    options.meter?.record({ calls: 1, ...tokensOf(json) });
    if (options.mode === 'readwrite') {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify({ url, body: compact(json) })}\n`);
    }
    return new Response(JSON.stringify(json), { status: res.status });
  };
}
