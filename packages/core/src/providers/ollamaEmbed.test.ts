import { describe, expect, it } from 'vitest';
import { EMBEDDING_DIM } from '../config/index.js';
import { OllamaEmbedder } from './ollamaEmbed.js';

function embedder(opts: { dims?: number; tags?: unknown } = {}) {
  const sent: { url: string; body: { input: string[] } | undefined }[] = [];
  const e = new OllamaEmbedder({
    maxChars: 50,
    http: {
      fetch: ((url: string, init?: RequestInit) => {
        const body = init?.body
          ? (JSON.parse(init.body as string) as { input: string[] })
          : undefined;
        sent.push({ url, body });
        if (url.endsWith('/api/tags')) {
          return Promise.resolve(
            Response.json(
              opts.tags ?? {
                models: [{ name: 'embeddinggemma:300m', digest: '85462619ee72abcdef' }],
              },
            ),
          );
        }
        const dims = opts.dims ?? EMBEDDING_DIM;
        return Promise.resolve(
          Response.json({
            embeddings: (body?.input ?? []).map((_, i) =>
              Array.from({ length: dims }, (_, j) => (j === i % dims ? 3 : 0)),
            ),
          }),
        );
      }) as typeof fetch,
      sleep: () => Promise.resolve(),
    },
  });
  return { e, sent };
}

describe('OllamaEmbedder', () => {
  it('batches 64 texts a request, applies the task prefixes, and normalizes', async () => {
    const { e, sent } = embedder();
    const vectors = await e.embed(
      Array.from({ length: 65 }, (_, i) => `t${i}`),
      { purpose: 'document' },
    );
    expect(vectors).toHaveLength(65);
    expect(sent.map((s) => s.body?.input.length)).toEqual([64, 1]);
    expect(sent[0]?.body?.input[0]).toBe('title: none | text: t0');
    expect(Math.hypot(...(vectors[0] ?? []))).toBeCloseTo(1, 10);
    const [q] = await e.embed(['where?'], { purpose: 'query' });
    expect(q).toHaveLength(EMBEDDING_DIM);
    expect(sent.at(-1)?.body?.input[0]).toBe('task: search result | query: where?');
  });

  it('caps long texts and counts every cap', async () => {
    const { e, sent } = embedder();
    await e.embed(['x'.repeat(80), 'short'], { purpose: 'document' });
    expect(sent[0]?.body?.input[0]).toBe(`title: none | text: ${'x'.repeat(50)}`);
    expect(e.truncated).toBe(1);
  });

  it('refuses vectors that would not fit the schema', async () => {
    const { e } = embedder({ dims: 1024 });
    await expect(e.embed(['a'], { purpose: 'document' })).rejects.toThrow(
      /1024-d vectors; the schema stores 768/,
    );
  });

  it('identifies its space by name and digest, and explains a missing model', async () => {
    expect(await embedder().e.embeddingSpace()).toBe('embeddinggemma:300m@85462619ee72');
    await expect(embedder({ tags: { models: [] } }).e.embeddingSpace()).rejects.toThrow(
      /ollama pull embeddinggemma:300m/,
    );
  });
});
