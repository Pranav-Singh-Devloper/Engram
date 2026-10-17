import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { UsageMeter, cachingFetch, compact } from './cache.js';
import { Pacer, laneOf } from './pacer.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(mode: 'readwrite' | 'readonly' | 'off', reply: () => Response) {
  const dir = mkdtempSync(path.join(tmpdir(), 'engram-cache-'));
  dirs.push(dir);
  let calls = 0;
  const meter = new UsageMeter();
  const fetch = cachingFetch({
    dir,
    mode,
    meter,
    fetch: () => {
      calls++;
      return Promise.resolve(reply());
    },
  });
  return { dir, fetch, meter, calls: () => calls };
}

const ok = () =>
  new Response(
    JSON.stringify({
      text: 'hi',
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3 },
    }),
  );
const post = (body: string, key = 'secret-1') => ({
  method: 'POST',
  body,
  headers: { 'x-goog-api-key': key },
});

function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.json'));
}

describe('cachingFetch', () => {
  it('stores a miss and answers the repeat from disk', async () => {
    const c = setup('readwrite', ok);
    const first = await c.fetch('https://example.test/a', post('{"q":1}'));
    const second = await c.fetch('https://example.test/a', post('{"q":1}'));
    expect(await first.json()).toEqual(await second.json());
    expect(c.calls()).toBe(1);
    expect(c.meter.take()).toEqual({ calls: 1, cached: 1, promptTokens: 10, outputTokens: 3 });
  });

  it('keys on URL and body, never on headers, and never stores the key', async () => {
    const c = setup('readwrite', ok);
    await c.fetch('https://example.test/a', post('{"q":1}', 'key-A'));
    await c.fetch('https://example.test/a', post('{"q":1}', 'key-B'));
    await c.fetch('https://example.test/a', post('{"q":2}'));
    expect(c.calls()).toBe(2);
    const stored = files(c.dir)
      .map((f) => readFileSync(path.join(c.dir, f), 'utf8'))
      .join('');
    expect(stored).not.toContain('key-A');
    expect(stored).not.toContain('secret');
  });

  it('answers a read-only miss with a non-retryable 404 and no network', async () => {
    const c = setup('readonly', ok);
    const res = await c.fetch('https://example.test/a', post('{}'));
    expect(res.status).toBe(404);
    expect(c.calls()).toBe(0);
  });

  it('does not cache failures', async () => {
    const c = setup('readwrite', () => new Response('quota', { status: 429 }));
    expect((await c.fetch('https://example.test/a', post('{}'))).status).toBe(429);
    expect(files(c.dir)).toHaveLength(0);
  });

  it('bypasses the cache entirely when off', async () => {
    const c = setup('off', ok);
    await c.fetch('https://example.test/a', post('{}'));
    await c.fetch('https://example.test/a', post('{}'));
    expect(c.calls()).toBe(2);
    expect(files(c.dir)).toHaveLength(0);
  });

  it('rounds embedding values to six decimals', () => {
    expect(compact({ embeddings: [{ values: [0.123456789, -0.5] }] })).toEqual({
      embeddings: [{ values: [0.123457, -0.5] }],
    });
    expect(compact({ text: 'x' })).toEqual({ text: 'x' });
  });
});

describe('Pacer', () => {
  it('spaces requests per lane at the configured rate', async () => {
    let t = 0;
    const sleeps: number[] = [];
    const pacer = new Pacer(
      { 'gemini-generate': 12, 'gemini-embed': 60, groq: 30 },
      () => t,
      (ms) => {
        sleeps.push(ms);
        t += ms;
        return Promise.resolve();
      },
    );
    const gen = 'https://generativelanguage.googleapis.com/v1beta/models/m:generateContent';
    const emb = 'https://generativelanguage.googleapis.com/v1beta/models/e:batchEmbedContents';
    await pacer.wait(gen);
    await pacer.wait(gen);
    await pacer.wait(emb);
    expect(sleeps).toEqual([5000]);
    expect(laneOf('https://api.groq.com/openai/v1/chat/completions')).toBe('groq');
    expect(laneOf('https://example.test')).toBeNull();
  });
});

describe('cachingFetch with streamed replies', () => {
  it('stores an NDJSON stream as text, replays it verbatim, and meters its tokens', async () => {
    const ndjson =
      '{"message":{"content":"{\\"a\\""}}\n{"message":{"content":":1}"},"done":true,"prompt_eval_count":40,"eval_count":7}\n';
    const { fetch, meter, calls } = setup('readwrite', () => new Response(ndjson));
    const first = await fetch('http://localhost:11434/api/chat', post('{"model":"qwen"}'));
    expect(await first.text()).toBe(ndjson);
    expect(meter.take()).toMatchObject({ calls: 1, promptTokens: 40, outputTokens: 7 });
    const again = await fetch('http://localhost:11434/api/chat', post('{"model":"qwen"}'));
    expect(await again.text()).toBe(ndjson);
    expect(calls()).toBe(1);
  });
});
