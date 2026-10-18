import { describe, expect, it } from 'vitest';
import { FakeProvider } from './fake.js';
import { OllamaProvider, jsonPart, readChatStream } from './ollama.js';
import { ProviderOutputError } from './provider.js';

const stream = (...chunks: object[]) => chunks.map((c) => JSON.stringify(c)).join('\n') + '\n';

function provider(
  replies: (string | Response)[],
  options: { structured?: 'format' | 'prompt' } = {},
) {
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  const embedder = new FakeProvider();
  const p = new OllamaProvider({
    ...options,
    embedder,
    http: {
      fetch: ((url: string, init: RequestInit) => {
        sent.push({ url, body: JSON.parse(init.body as string) as Record<string, unknown> });
        const next = replies.shift() ?? '';
        return Promise.resolve(
          typeof next === 'string' ? new Response(next, { status: 200 }) : next,
        );
      }) as typeof fetch,
      sleep: () => Promise.resolve(),
    },
  });
  return { p, sent, embedder };
}

const extraction = JSON.stringify({ importance: 0.6, candidates: [] });

describe('OllamaProvider', () => {
  it('sends the shared prompt as a streamed, schema-constrained chat with thinking off', async () => {
    const { p, sent } = provider([
      stream(
        { message: { content: extraction.slice(0, 10) } },
        { message: { content: extraction.slice(10) }, done: true },
      ),
    ]);
    const out = await p.processEpisode({
      content: 'I live in Paris.',
      role: 'user',
      occurredAt: new Date('2024-01-15T09:00:00Z'),
      predicates: ['lives_in'],
    });
    expect(out).toEqual({ importance: 0.6, candidates: [] });
    const [req] = sent;
    expect(req?.url).toBe('http://localhost:11434/api/chat');
    expect(req?.body).toMatchObject({
      model: 'qwen3.5:9b',
      stream: true,
      think: false,
      options: { temperature: 0, seed: 42, num_ctx: 32768, num_predict: 4096 },
    });
    const messages = req?.body.messages as { role: string; content: string }[];
    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(messages[1]?.content).toContain('I live in Paris.');
    expect(typeof req?.body.format).toBe('object');
  });

  it('repairs once, sending its reply back as the assistant', async () => {
    const valid = JSON.stringify({ importance: 0.5, candidates: [] });
    const { p, sent } = provider([
      stream({ message: { content: '{"importance": 7}' }, done: true }),
      stream({ message: { content: valid }, done: true }),
    ]);
    await p.processEpisode({ content: 'x', role: 'user', occurredAt: new Date(), predicates: [] });
    const roles = (sent[1]?.body.messages as { role: string }[]).map((m) => m.role);
    expect(roles).toEqual(['system', 'user', 'assistant', 'user']);
  });

  it('delegates embeddings to the injected embedder', async () => {
    const { p, embedder } = provider([]);
    expect(await p.embed(['a', 'b'], { purpose: 'document' })).toHaveLength(2);
    expect(embedder.callsTo('embed')).toHaveLength(1);
  });
});

describe('OllamaProvider without constrained decoding', () => {
  const unavailable = () =>
    new Response('{"error":"structured output is unavailable"}', { status: 501 });
  const valid = JSON.stringify({ importance: 0.5, candidates: [] });
  const input = { content: 'x', role: 'user' as const, occurredAt: new Date(), predicates: [] };

  it('switches to the schema-in-prompt mode on a 501, for good', async () => {
    const { p, sent } = provider([
      unavailable(),
      stream({ message: { content: '```json\n' + valid + '\n```' }, done: true }),
      stream({ message: { content: valid }, done: true }),
    ]);
    expect(await p.processEpisode(input)).toEqual({ importance: 0.5, candidates: [] });
    expect(p.structuredMode).toBe('prompt');
    expect(sent[1]?.body.format).toBeUndefined();
    const system = (sent[1]?.body.messages as { content: string }[])[0]?.content ?? '';
    expect(system).toMatch(/matching this JSON Schema exactly/);
    // The next call goes straight to prompt mode.
    await p.processEpisode(input);
    expect(sent).toHaveLength(3);
    expect(sent[2]?.body.format).toBeUndefined();
  });

  it("doesn't switch when constrained decoding was required", async () => {
    const { p } = provider([unavailable()], { structured: 'format' });
    await expect(p.processEpisode(input)).rejects.toThrow(/structured output is unavailable/);
  });

  it('finds the JSON object in fenced or padded replies', () => {
    expect(jsonPart('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(jsonPart('Sure! {"a":{"b":2}} hope that helps')).toBe('{"a":{"b":2}}');
    expect(jsonPart('{"a":1}')).toBe('{"a":1}');
  });
});

describe('readChatStream', () => {
  it('joins chunks, and rejects errors, truncated and empty streams', () => {
    expect(
      readChatStream(
        stream({ message: { content: 'a' } }, { message: { content: 'b' }, done: true }),
      ),
    ).toBe('ab');
    expect(() => readChatStream(stream({ error: 'model not found' }))).toThrow(/model not found/);
    expect(() => readChatStream(stream({ message: { content: 'a' } }))).toThrow(
      ProviderOutputError,
    );
    expect(() => readChatStream(stream({ message: { content: '' }, done: true }))).toThrow(/Empty/);
  });
});
