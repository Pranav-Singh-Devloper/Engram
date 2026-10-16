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

/** A non-retryable HTTP failure, or a retryable one that ran out of attempts. */
export class ProviderHttpError extends ProviderError {
  override name = 'ProviderHttpError';
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly attempts: number,
  ) {
    super(message);
  }
}
