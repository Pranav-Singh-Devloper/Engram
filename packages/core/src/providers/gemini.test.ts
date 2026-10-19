// No network: every test injects a fake fetch and an instant sleep.
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { EMBEDDING_DIM } from '../config/index.js';
import { GeminiProvider, embedText } from './gemini.js';
import type { GeminiOptions } from './gemini.js';
import { postJson, retryInfoMs } from './http.js';
import { ProviderHttpError, ProviderOutputError } from './provider.js';

type Handler = (url: string, body: unknown) => Response | Promise<Response>;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function setup(handler: Handler, options: Partial<GeminiOptions> = {}) {
  const requests: { url: string; body: unknown; headers: Headers }[] = [];
  const sleeps: number[] = [];
  // postJson always sends a string URL and a JSON string body.
  const fetch = vi.fn(
    async (url: string, init: { body: string; headers: Record<string, string> }) => {
      const body: unknown = JSON.parse(init.body);
      requests.push({ url, body, headers: new Headers(init.headers) });
      return handler(url, body);
    },
  );
  const provider = new GeminiProvider({
    apiKey: 'test-key',
    chatModel: 'test-chat',
    http: {
      fetch: fetch as unknown as typeof globalThis.fetch,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      random: () => 0.5,
    },
    ...options,
  });
  return { provider, requests, sleeps };
}

/** A batchEmbedContents reply: one vector per request, scaled so it is not unit-norm. */
function embedReply(body: unknown): Response {
  const { requests } = body as { requests: unknown[] };
  return json({
    embeddings: requests.map((_, i) => ({
      values: Array.from({ length: EMBEDDING_DIM }, (_, j) => (j === i ? 3 : 0)),
    })),
  });
}

describe('GeminiProvider.embed', () => {
  it('sends task-prefixed texts at 768 dims with the key in a header', async () => {
    const { provider, requests } = setup((_, body) => embedReply(body));
    await provider.embed(['Sam lives in Berlin'], { purpose: 'document' });

    const [req] = requests;
    expect(req?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents',
    );
    expect(req?.headers.get('x-goog-api-key')).toBe('test-key');
    expect(req?.url).not.toContain('test-key');
    expect(req?.body).toEqual({
      requests: [
        {
          model: 'models/gemini-embedding-2',
          content: { parts: [{ text: 'title: none | text: Sam lives in Berlin' }] },
          outputDimensionality: 768,
        },
      ],
    });
  });

  it('uses the query prefix for queries', () => {
    expect(embedText('where?', 'query')).toBe('task: search result | query: where?');
    // Beyond the model's input limit, only the start is embedded.
    expect(embedText('x'.repeat(30_000), 'document')).toBe(
      `title: none | text: ${'x'.repeat(24_000)}`,
    );
  });

  it('L2-normalizes the returned vectors', async () => {
    const { provider } = setup((_, body) => embedReply(body));
    const [v] = await provider.embed(['a'], { purpose: 'query' });
    expect(v?.[0]).toBe(1);
    expect(Math.hypot(...(v ?? []))).toBeCloseTo(1, 10);
  });

  it('splits more than 100 texts into batches and keeps their order', async () => {
    const { provider, requests } = setup((_, body) => embedReply(body));
    const vectors = await provider.embed(
      Array.from({ length: 150 }, (_, i) => `text ${i}`),
      { purpose: 'document' },
    );
    expect(requests.map((r) => (r.body as { requests: unknown[] }).requests.length)).toEqual([
      100, 50,
    ]);
    expect(vectors).toHaveLength(150);
    expect(vectors[101]?.[1]).toBe(1);
  });

  it('makes no request for an empty list', async () => {
    const { provider, requests } = setup(() => json({}));
    expect(await provider.embed([], { purpose: 'document' })).toEqual([]);
    expect(requests).toHaveLength(0);
  });

  it('rejects a reply with the wrong number or size of vectors', async () => {
    const short = setup(() => json({ embeddings: [] }));
    await expect(short.provider.embed(['a'], { purpose: 'document' })).rejects.toThrow(
      ProviderOutputError,
    );
    const wrongDim = setup(() => json({ embeddings: [{ values: [1, 2, 3] }] }));
    await expect(wrongDim.provider.embed(['a'], { purpose: 'document' })).rejects.toThrow(
      /768-dim/,
    );
  });

  it('refuses to start without an API key', () => {
    expect(() => new GeminiProvider({ apiKey: '' })).toThrow(/GEMINI_API_KEY/);
  });
});

describe('postJson retries', () => {
  const retry = { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 1000 };

  function deps(responses: (Response | Error)[]) {
    const sleeps: number[] = [];
    let calls = 0;
    return {
      sleeps,
      calls: () => calls,
      deps: {
        fetch: (() => {
          const next = responses[calls++];
          if (next instanceof Error) return Promise.reject(next);
          return Promise.resolve(next ?? json({}, 500));
        }) as unknown as typeof fetch,
        sleep: (ms: number) => {
          sleeps.push(ms);
          return Promise.resolve();
        },
        random: () => 0.5,
      },
    };
  }

  it('retries 429 and 5xx with exponential backoff, then succeeds', async () => {
    const d = deps([json({}, 429), json({}, 503), json({ ok: true })]);
    await expect(postJson('u', {}, { headers: {}, retry, deps: d.deps })).resolves.toEqual({
      ok: true,
    });
    // base · 2^attempt · (0.5 + 0.5/2)
    expect(d.sleeps).toEqual([75, 150]);
  });

  it('honours a Retry-After within the backoff cap', async () => {
    const d = deps([json({}, 429, { 'retry-after': '0.3' }), json({})]);
    await postJson('u', {}, { headers: {}, retry, deps: d.deps });
    expect(d.sleeps).toEqual([300]);
  });

  it('fails at once, marked exhausted, when the wait exceeds the cap (a daily quota)', async () => {
    const d = deps([json({}, 429, { 'retry-after': '3600' }), json({})]);
    const err = await postJson('u', {}, { headers: {}, retry, deps: d.deps }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ProviderHttpError);
    expect(err).toMatchObject({ status: 429, quotaExhausted: true, retryAfterMs: 3_600_000 });
    expect(d.sleeps).toEqual([]);
    expect(d.calls()).toBe(1);
  });

  it("honours Gemini's RetryInfo delay from the error body", async () => {
    const quota = {
      error: {
        code: 429,
        details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '0.25s' }],
      },
    };
    const d = deps([json(quota, 429), json({})]);
    await postJson('u', {}, { headers: {}, retry, deps: d.deps });
    expect(d.sleeps).toEqual([250]);
  });

  it('parses RetryInfo delays', () => {
    expect(retryInfoMs('{"retryDelay": "8s"}')).toBe(8000);
    expect(retryInfoMs('{"retryDelay":"8.25571627s"}')).toBe(8256);
    expect(retryInfoMs('{"error": "quota"}')).toBeUndefined();
  });

  it('retries network errors', async () => {
    const d = deps([new TypeError('fetch failed'), json({ ok: true })]);
    await expect(postJson('u', {}, { headers: {}, retry, deps: d.deps })).resolves.toEqual({
      ok: true,
    });
  });

  it('gives up after maxRetries with the last status', async () => {
    const d = deps(Array.from({ length: 10 }, () => json({ error: 'quota' }, 429)));
    const err = await postJson('u', {}, { headers: {}, retry, deps: d.deps }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ProviderHttpError);
    expect(err).toMatchObject({ status: 429, attempts: 4 });
    expect(d.calls()).toBe(4);
  });

  it('fails immediately on a non-retryable status', async () => {
    const d = deps([json({ error: 'bad key' }, 400), json({})]);
    await expect(postJson('u', {}, { headers: {}, retry, deps: d.deps })).rejects.toMatchObject({
      status: 400,
      attempts: 1,
    });
    expect(d.calls()).toBe(1);
  });
});

describe('GeminiProvider.generate', () => {
  const schema = z.object({ city: z.string() });
  const reply = (text: string) => json({ candidates: [{ content: { parts: [{ text }] } }] });

  it('requests JSON and returns the validated value', async () => {
    const { provider, requests } = setup(() => reply('{"city":"Berlin"}'));
    await expect(provider.generate({ system: 'sys', user: 'where?', schema })).resolves.toEqual({
      city: 'Berlin',
    });
    expect(requests[0]?.url).toContain('/models/test-chat:generateContent');
    expect(requests[0]?.body).toMatchObject({
      systemInstruction: { parts: [{ text: 'sys' }] },
      contents: [{ role: 'user', parts: [{ text: 'where?' }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    });
  });

  it('repairs once by showing the model its invalid reply', async () => {
    const replies = ['{"town":"Berlin"}', '{"city":"Berlin"}'];
    const { provider, requests } = setup(() => reply(replies.shift() ?? ''));
    await expect(provider.generate({ system: 's', user: 'u', schema })).resolves.toEqual({
      city: 'Berlin',
    });
    const contents = (requests[1]?.body as { contents: { role: string }[] }).contents;
    expect(contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(JSON.stringify(contents[2])).toContain('city');
  });

  it('throws a typed error when the repair fails too', async () => {
    const { provider, requests } = setup(() => reply('not json'));
    const err = await provider
      .generate({ system: 's', user: 'u', schema })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderOutputError);
    expect((err as ProviderOutputError).raw).toBe('not json');
    expect(requests).toHaveLength(2);
  });

  it('reports an empty reply with its finish reason', async () => {
    const { provider } = setup(() => json({ candidates: [{ finishReason: 'SAFETY' }] }));
    await expect(provider.generate({ system: 's', user: 'u', schema })).rejects.toThrow(/SAFETY/);
  });

  it('needs a chat model', async () => {
    const { provider } = setup(() => reply('{}'), { chatModel: undefined });
    await expect(provider.generate({ system: 's', user: 'u', schema })).rejects.toThrow(
      /chat model/,
    );
  });
});

describe('GeminiProvider.processEpisode', () => {
  const none = {
    kind: 'none',
    date: null,
    amount: null,
    unit: null,
    direction: null,
    year: null,
    month: null,
    season: null,
  };
  const candidate = (validFrom: Record<string, unknown>) => ({
    subject: { name: 'SELF', type: 'person', description: null },
    predicate: 'lives_in',
    objectKind: 'entity',
    objectName: 'Berlin',
    objectType: 'place',
    objectDescription: null,
    statement: 'The user lives in Berlin.',
    validFrom,
    validTo: none,
    isCorrection: false,
    confidence: 0.9,
  });
  const reply = (body: unknown) =>
    json({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] });
  const input = {
    content: 'I moved to Berlin last month.',
    role: 'user' as const,
    occurredAt: new Date('2024-06-10T09:00:00Z'),
    predicates: ['lives_in'],
  };

  it('sends the wire JSON schema and maps the reply onto the contract', async () => {
    const hint = { ...none, kind: 'relative', amount: 1, unit: 'month', direction: 'ago' };
    const { provider, requests } = setup(() =>
      reply({ importance: 0.6, candidates: [candidate(hint)] }),
    );
    const out = await provider.processEpisode(input);
    expect(out.candidates[0]?.validFrom).toEqual({
      kind: 'relative',
      amount: 1,
      unit: 'month',
      direction: 'ago',
    });
    const config = (requests[0]?.body as { generationConfig: Record<string, unknown> })
      .generationConfig;
    expect(config.responseJsonSchema).toBeDefined();
  });

  it('repairs a reply that only fails in the wire-to-contract mapping', async () => {
    const replies = [
      { importance: 0.6, candidates: [candidate({ ...none, kind: 'relative', amount: 1 })] },
      { importance: 0.6, candidates: [candidate(none)] },
    ];
    const { provider, requests } = setup(() => reply(replies.shift()));
    const out = await provider.processEpisode(input);
    expect(out.candidates[0]?.validFrom).toEqual({ kind: 'none' });
    expect(requests).toHaveLength(2);
  });
});

describe('ids never reach the prompt', () => {
  const reply = (body: unknown) =>
    json({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] });
  const uuid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

  it('compose labels memories m1… and maps used ids back', async () => {
    const { provider, requests } = setup(() =>
      reply({ answer: 'Osaka.', supported: true, usedMemoryIds: ['m2'] }),
    );
    const out = await provider.compose({
      question: 'Where?',
      now: new Date('2024-09-01T00:00:00Z'),
      memories: [
        {
          id: uuid(1),
          kind: 'fact',
          text: 'Krakow',
          validFrom: new Date('2024-01-01T00:00:00Z'),
          validTo: null,
        },
        {
          id: uuid(2),
          kind: 'fact',
          text: 'Osaka',
          validFrom: new Date('2024-05-01T00:00:00Z'),
          validTo: null,
        },
      ],
    });
    expect(out.usedMemoryIds).toEqual([uuid(2)]);
    expect(JSON.stringify(requests[0]?.body)).not.toContain(uuid(1));
    expect(JSON.stringify(requests[0]?.body)).toContain('[m1]');
  });

  it('disambiguate and adjudicate do the same with candidates and facts', async () => {
    const d = setup(() => reply({ entityId: 'c2', reason: 'the chef' }));
    const chosen = await d.provider.disambiguate({
      mention: { name: 'Sam', type: 'person', description: null },
      context: 'Sam cooked.',
      candidates: [1, 2].map((n) => ({
        id: uuid(n),
        name: 'Sam',
        type: 'person' as const,
        description: null,
        aliases: [],
      })),
    });
    expect(chosen.entityId).toBe(uuid(2));
    expect(JSON.stringify(d.requests[0]?.body)).not.toContain(uuid(1));

    const a = setup(() =>
      reply({ decision: 'update', targetFactId: 'f1', reason: 'moved', flagPredicate: false }),
    );
    const decided = await a.provider.adjudicate({
      predicate: 'lives_in',
      context: 'I moved.',
      cardinality: 'one',
      mutability: 'dynamic',
      candidate: {
        statement: 's',
        validFrom: new Date('2024-05-01T00:00:00Z'),
        validTo: null,
        confidence: 0.9,
        isCorrection: false,
      },
      existing: [
        {
          id: uuid(3),
          statement: 's',
          validFrom: new Date('2024-01-01T00:00:00Z'),
          validTo: null,
          confidence: 0.9,
        },
      ],
    });
    expect(decided.targetFactId).toBe(uuid(3));
    expect(JSON.stringify(a.requests[0]?.body)).not.toContain(uuid(3));
  });
});

describe('key fallback', () => {
  const daily = () =>
    json(
      {
        error: {
          code: 429,
          details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '19293s' }],
        },
      },
      429,
    );
  const minute = () =>
    json(
      {
        error: {
          details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '0.2s' }],
        },
      },
      429,
    );

  function keyed(byKey: Record<string, (() => Response)[]>) {
    const used: string[] = [];
    const switches: number[] = [];
    const fetch = (_url: string, init: { headers: Record<string, string> }) => {
      const key = init.headers['x-goog-api-key'] ?? '';
      used.push(key);
      return Promise.resolve((byKey[key]?.shift() ?? (() => embedReply({ requests: [1] })))());
    };
    const provider = new GeminiProvider({
      apiKey: 'main',
      fallbackApiKeys: ['spare'],
      chatModel: 'gemini-test',
      onKeySwitch: (i) => switches.push(i),
      http: {
        fetch: fetch as unknown as typeof globalThis.fetch,
        sleep: () => Promise.resolve(),
        random: () => 0.5,
      },
    });
    return { provider, used, switches };
  }

  it("moves to the fallback key when the main key's daily quota is exhausted, and stays there", async () => {
    const k = keyed({ main: [daily] });
    await k.provider.embed(['a'], { purpose: 'document' });
    await k.provider.embed(['b'], { purpose: 'document' });
    expect(k.used).toEqual(['main', 'spare', 'spare']);
    expect(k.switches).toEqual([1]);
    expect(k.provider.activeKeys).toEqual({ embed: 1, generate: 0 });
  });

  it('tracks generation and embedding quotas separately on each key', async () => {
    // Measured 2026-10-19: a key out of generate quota still served embeddings,
    // but one shared key index moved both lanes off it.
    const composed = () =>
      json({
        candidates: [
          {
            content: {
              parts: [
                { text: JSON.stringify({ answer: 'x', supported: false, usedMemoryIds: [] }) },
              ],
            },
          },
        ],
      });
    const k = keyed({ main: [daily, () => embedReply({ requests: [1] })], spare: [composed] });
    await k.provider.compose({ question: 'q', now: new Date(), memories: [] });
    await k.provider.embed(['a'], { purpose: 'document' });
    expect(k.used).toEqual(['main', 'spare', 'main']);
    expect(k.provider.activeKeys).toEqual({ embed: 0, generate: 1 });
  });

  it('skips a key whose project is denied access', async () => {
    const denied = () => json({ error: { code: 403, status: 'PERMISSION_DENIED' } }, 403);
    const k = keyed({ main: [denied] });
    await k.provider.embed(['a'], { purpose: 'document' });
    expect(k.used).toEqual(['main', 'spare']);
  });

  it('rides out a per-minute limit on the same key', async () => {
    const k = keyed({ main: [minute] });
    await k.provider.embed(['a'], { purpose: 'document' });
    expect(k.used).toEqual(['main', 'main']);
    expect(k.switches).toEqual([]);
  });

  it('throws once every key is exhausted', async () => {
    const k = keyed({ main: [daily], spare: [daily] });
    await expect(k.provider.embed(['a'], { purpose: 'document' })).rejects.toMatchObject({
      quotaExhausted: true,
    });
    expect(k.used).toEqual(['main', 'spare']);
  });
});

describe('GeminiProvider.summarize', () => {
  const none = {
    kind: 'none',
    date: null,
    amount: null,
    unit: null,
    direction: null,
    year: null,
    month: null,
    season: null,
  };
  const wire = (turns: string[]) => ({
    subject: { name: 'SELF', type: 'person', description: null },
    predicate: 'lives_in',
    objectKind: 'entity',
    objectName: 'Osaka',
    objectType: 'place',
    objectDescription: null,
    statement: 'The user lives in Osaka.',
    validFrom: none,
    validTo: none,
    isCorrection: false,
    confidence: 0.9,
    turns,
  });
  const reply = (body: unknown) =>
    json({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] });
  const episodes = ['ep-a', 'ep-b'].map((id, i) => ({
    id,
    role: 'user' as const,
    content: `turn ${i}`,
    occurredAt: new Date('2024-06-18T09:00:00Z'),
  }));

  it('labels turns t1… in the prompt and maps cited labels back to episode ids', async () => {
    const { provider, requests } = setup(() =>
      reply({
        summary: 'The user moved to Osaka.',
        candidates: [wire(['t2']), wire(['t9']), wire(['t1', 't9'])],
      }),
    );
    const out = await provider.summarize({ episodes, predicates: ['lives_in'] });
    expect(out.summary).toBe('The user moved to Osaka.');
    // An invented label is dropped; a candidate citing only invented labels is dropped.
    expect(out.candidates.map((c) => c.sourceEpisodeIds)).toEqual([['ep-b'], ['ep-a']]);
    const sent = JSON.stringify(requests[0]?.body);
    expect(sent).toContain('[t1]');
    expect(sent).not.toContain('ep-a');
  });
});
