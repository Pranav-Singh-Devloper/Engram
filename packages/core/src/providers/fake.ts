// Deterministic provider for tests and `demo:offline`. It never touches the
// network. Embeddings come from feature hashing, so texts sharing words land
// close together. Structured methods answer only what a test has scripted,
// so a test can't pass by accident on a default reply.
import { EMBEDDING_DIM } from '../config/index.js';
import { l2Normalize } from '../db/vector.js';
import { CONTRACTS } from './contracts.js';
import type { EmbedPurpose, MethodInput, MethodOutput, StructuredMethod } from './contracts.js';
import { ProviderError } from './provider.js';
import type { Provider } from './provider.js';

type Matcher<M extends StructuredMethod> = string | ((input: ParsedInput<M>) => boolean);
type Responder<M extends StructuredMethod> =
  MethodOutput<M> | ((input: ParsedInput<M>) => MethodOutput<M>);
/** Inputs after parsing, e.g. with dates as `Date`. */
type ParsedInput<M extends StructuredMethod> = ReturnType<(typeof CONTRACTS)[M]['input']['parse']>;

interface Script<M extends StructuredMethod> {
  match: Matcher<M>;
  respond: Responder<M>;
}

export interface FakeCall {
  method: 'embed' | StructuredMethod;
  input: unknown;
}

export class FakeProviderError extends ProviderError {
  override name = 'FakeProviderError';
}

/** FNV-1a, 32-bit. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Bag-of-words feature hashing into EMBEDDING_DIM buckets, L2-normalized. */
export function fakeEmbedding(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIM).fill(0);
  const tokens =
    text
      .toLowerCase()
      .normalize('NFKD')
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const token of tokens) {
    const index = hash(token) % EMBEDDING_DIM;
    v[index] = (v[index] ?? 0) + (hash(`${token}#sign`) & 1 ? 1 : -1);
  }
  if (!v.some((x) => x !== 0)) v[0] = 1;
  return l2Normalize(v);
}

export class FakeProvider implements Provider {
  readonly name = 'fake';
  readonly calls: FakeCall[] = [];
  private readonly scripts: { [M in StructuredMethod]: Script<M>[] } = {
    processEpisode: [],
    disambiguate: [],
    adjudicate: [],
    summarize: [],
    compose: [],
    judge: [],
  };

  /**
   * Scripts a response. `match` is a substring of the input's JSON or a
   * predicate on the parsed input; the first matching script wins. Responses
   * are validated against the method's contract when they're used.
   */
  when<M extends StructuredMethod>(method: M, match: Matcher<M>, respond: Responder<M>): this {
    (this.scripts[method] as Script<M>[]).push({ match, respond });
    return this;
  }

  callsTo(method: FakeCall['method']): unknown[] {
    return this.calls.filter((c) => c.method === method).map((c) => c.input);
  }

  embed(texts: readonly string[], options: { purpose: EmbedPurpose }): Promise<number[][]> {
    this.calls.push({ method: 'embed', input: { texts: [...texts], purpose: options.purpose } });
    return Promise.resolve(texts.map(fakeEmbedding));
  }

  processEpisode = (input: MethodInput<'processEpisode'>) => this.respond('processEpisode', input);
  disambiguate = (input: MethodInput<'disambiguate'>) => this.respond('disambiguate', input);
  adjudicate = (input: MethodInput<'adjudicate'>) => this.respond('adjudicate', input);
  summarize = (input: MethodInput<'summarize'>) => this.respond('summarize', input);
  compose = (input: MethodInput<'compose'>) => this.respond('compose', input);
  judge = (input: MethodInput<'judge'>) => this.respond('judge', input);

  private respond<M extends StructuredMethod>(
    method: M,
    raw: MethodInput<M>,
  ): Promise<MethodOutput<M>> {
    try {
      const input = CONTRACTS[method].input.parse(raw) as ParsedInput<M>;
      this.calls.push({ method, input });
      const json = JSON.stringify(input);
      const script = (this.scripts[method] as Script<M>[]).find(({ match }) =>
        typeof match === 'string' ? json.includes(match) : match(input),
      );
      if (!script) {
        throw new FakeProviderError(
          `No scripted ${method} response matches input: ${json.slice(0, 300)}`,
        );
      }
      const output = typeof script.respond === 'function' ? script.respond(input) : script.respond;
      // Parse a copy so a test can't mutate its script through the result.
      const parsed = CONTRACTS[method].output.parse(structuredClone(output)) as MethodOutput<M>;
      return Promise.resolve(parsed);
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }
}
