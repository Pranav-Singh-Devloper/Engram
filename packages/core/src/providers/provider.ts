import type { EmbedPurpose, MethodInput, MethodOutput, StructuredMethod } from './contracts.js';

/**
 * The provider adapter (SPEC §14). Embeddings are always EMBEDDING_DIM long
 * and L2-normalized. Structured outputs are already validated against
 * `CONTRACTS`. The judge is configured as a separate instance, preferably
 * from a different model family.
 */
export type Provider = {
  readonly name: string;
  embed(texts: readonly string[], options: { purpose: EmbedPurpose }): Promise<number[][]>;
  /**
   * The vector space `embed` produces, e.g. "gemini-embedding-2" or
   * "embeddinggemma:300m@<digest>". Vectors from different spaces can't be
   * compared, so a namespace is bound to one (P08b, ADR-017).
   */
  embeddingSpace(): Promise<string>;
} & {
  readonly [M in StructuredMethod]: (input: MethodInput<M>) => Promise<MethodOutput<M>>;
};

export class ProviderError extends Error {
  override name = 'ProviderError';
}

/** The model's reply didn't match the contract, even after one repair attempt. */
export class ProviderOutputError extends ProviderError {
  override name = 'ProviderOutputError';
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
  }
}

/**
 * The model refused the prompt itself (a safety block, e.g. Gemini's
 * PROHIBITED_CONTENT). The same input is refused every time, so callers give
 * up on it instead of retrying.
 */
export class ProviderBlockedError extends ProviderOutputError {
  override name = 'ProviderBlockedError';
}

/** A non-retryable HTTP failure, or a retryable one that ran out of attempts. */
export class ProviderHttpError extends ProviderError {
  override name = 'ProviderHttpError';
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly attempts: number,
    /** Set when the server asked for a wait longer than backoff allows: a quota, not a burst. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }

  /** A 429 whose quota won't come back within backoff (typically a daily quota). */
  get quotaExhausted(): boolean {
    return this.status === 429 && this.retryAfterMs !== undefined;
  }
}
