// One provider's models with another's embeddings. The bench uses it to run
// Gemini generation over local embeddings for LongMemEval (ADR-018), whose
// 45k unique turns would take ~11 days of Gemini's free embedding quota.
import { CONTRACTS } from './contracts.js';
import type { StructuredMethod } from './contracts.js';
import type { Provider } from './provider.js';

export type Embedder = Pick<Provider, 'embed' | 'embeddingSpace'> & { readonly name?: string };

export function withEmbedder(base: Provider, embedder: Embedder): Provider {
  const methods = Object.fromEntries(
    (Object.keys(CONTRACTS) as StructuredMethod[]).map((m) => [
      m,
      (input: never) => (base[m] as (i: never) => Promise<unknown>)(input),
    ]),
  );
  return {
    ...methods,
    name: `${base.name}+${embedder.name ?? 'embedder'}`,
    embed: (texts, options) => embedder.embed(texts, options),
    embeddingSpace: () => embedder.embeddingSpace(),
  } as Provider;
}
