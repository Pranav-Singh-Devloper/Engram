import { ProviderHttpError } from './provider.js';

export interface RetryOptions {
  /** Retries after the first attempt. */
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY: RetryOptions = { maxRetries: 5, baseDelayMs: 1000, maxDelayMs: 60_000 };

/** Injectable so tests run instantly and deterministically. */
export interface HttpDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

export const defaultHttpDeps: HttpDeps = {
  fetch: (...args) => fetch(...args),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
};

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/**
 * Google APIs put the wait in the error body (`google.rpc.RetryInfo`, e.g.
 * `"retryDelay": "8s"`) rather than a Retry-After header.
 */
export function retryInfoMs(body: string): number | undefined {
  const match = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body);
  return match?.[1] === undefined ? undefined : Math.ceil(Number(match[1]) * 1000);
}

/** Retry-After in seconds or as an HTTP date. */
function retryAfterMs(header: string | null): number | undefined {
  if (header === null) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

/**
 * POSTs JSON and returns the parsed body. Rate limits (429), server errors
 * and network failures are retried with exponential backoff and jitter,
 * honouring Retry-After or the body's RetryInfo. Other statuses fail immediately.
 */
export async function postJson(
  url: string,
  body: unknown,
  options: { headers: Record<string, string>; retry: RetryOptions; deps: HttpDeps },
): Promise<unknown> {
  const { retry, deps } = options;
  for (let attempt = 0; ; attempt++) {
    const attempts = attempt + 1;
    let res: Response;
    try {
      res = await deps.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...options.headers },
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (attempt >= retry.maxRetries) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new ProviderHttpError(
          `Request failed after ${attempts} attempts: ${reason}`,
          undefined,
          attempts,
        );
      }
      await deps.sleep(backoff(attempt, undefined, retry, deps));
      continue;
    }

    if (res.ok) return res.json();

    const text = await res.text();
    const detail = text.slice(0, 500);
    if (!RETRYABLE.has(res.status) || attempt >= retry.maxRetries) {
      throw new ProviderHttpError(
        `HTTP ${res.status} after ${attempts} attempt(s): ${detail}`,
        res.status,
        attempts,
      );
    }
    const hinted = retryAfterMs(res.headers.get('retry-after')) ?? retryInfoMs(text);
    await deps.sleep(backoff(attempt, hinted, retry, deps));
  }
}

function backoff(
  attempt: number,
  hinted: number | undefined,
  retry: RetryOptions,
  deps: HttpDeps,
): number {
  if (hinted !== undefined) return Math.min(hinted, retry.maxDelayMs);
  const exponential = Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** attempt);
  // Full jitter in [50%, 100%] so parallel bench workers don't retry in lockstep.
  return exponential * (0.5 + deps.random() / 2);
}
