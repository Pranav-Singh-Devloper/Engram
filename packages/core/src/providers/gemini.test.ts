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

  it('honours Retry-After, capped at maxDelayMs', async () => {
    const d = deps([
      json({}, 429, { 'retry-after': '2' }),
      json({}, 429, { 'retry-after': '0.3' }),
      json({}),
    ]);
    await postJson('u', {}, { headers: {}, retry, deps: d.deps });
    expect(d.sleeps).toEqual([1000, 300]);
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
