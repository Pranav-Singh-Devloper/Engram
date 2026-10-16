import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { GroqProvider } from './groq.js';
import { ProviderOutputError } from './provider.js';

function setup(replies: string[]) {
  const requests: {
    url: string;
    body: Record<string, unknown>;
    headers: Record<string, string>;
  }[] = [];
  const fetch = (url: string, init: { body: string; headers: Record<string, string> }) => {
    requests.push({
      url,
      body: JSON.parse(init.body) as Record<string, unknown>,
      headers: init.headers,
    });
    const content = replies.shift() ?? '';
    return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content } }] })));
  };
  const provider = new GroqProvider({
    apiKey: 'gsk-test',
    http: {
      fetch: fetch as unknown as typeof globalThis.fetch,
      sleep: () => Promise.resolve(),
      random: () => 0.5,
    },
  });
  return { provider, requests };
}

const input = { question: 'Where do I live?', expected: 'Osaka', answer: 'You live in Osaka.' };

describe('GroqProvider', () => {
  it('judges with a strict JSON schema on gpt-oss-120b, key in a bearer header', async () => {
    const { provider, requests } = setup(['{"correct":true,"reason":"same city"}']);
    await expect(provider.judge(input)).resolves.toEqual({ correct: true, reason: 'same city' });
    const [req] = requests;
    expect(req?.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(req?.headers.authorization).toBe('Bearer gsk-test');
    expect(req?.body).toMatchObject({
      model: 'openai/gpt-oss-120b',
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'judgement',
          strict: true,
          schema: { type: 'object', additionalProperties: false, required: ['correct', 'reason'] },
        },
      },
    });
    expect(JSON.stringify(req?.body)).toContain('Expected: Osaka');
  });

  it('repairs once, then gives up with a typed error', async () => {
    const schema = z.object({ city: z.string() });
    const ok = setup(['{"town":"Osaka"}', '{"city":"Osaka"}']);
    await expect(
      ok.provider.generate({ system: 's', user: 'u', schema, schemaName: 'x' }),
    ).resolves.toEqual({ city: 'Osaka' });
    expect((ok.requests[1]?.body.messages as { role: string }[]).map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
    const bad = setup(['nope', 'still nope']);
    await expect(
      bad.provider.generate({ system: 's', user: 'u', schema, schemaName: 'x' }),
    ).rejects.toThrow(ProviderOutputError);
  });

  it('closes nested objects too', async () => {
    const schema = z.object({ inner: z.object({ a: z.string(), b: z.number().nullable() }) });
    const { provider, requests } = setup(['{"inner":{"a":"x","b":null}}']);
    await provider.generate({ system: 's', user: 'u', schema, schemaName: 'x' });
    const sent = JSON.stringify(requests[0]?.body);
    expect(sent).toContain('"required":["a","b"]');
    expect(sent.match(/"additionalProperties":false/g)).toHaveLength(2);
  });

  it('refuses a missing key and has no embeddings', async () => {
    expect(() => new GroqProvider({ apiKey: '' })).toThrow(/key/);
    await expect(setup([]).provider.embed()).rejects.toThrow(/no embeddings/);
  });
});
