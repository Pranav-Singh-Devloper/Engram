import { randomUUID } from 'node:crypto';
import { FakeProvider } from '@engram/core';
import { aboutSelf, testDb } from '@engram/core/testing';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, describe, expect, it } from 'vitest';
import { createEngramHttpHandler } from './http.js';

const db = testDb();
const run = randomUUID().slice(0, 8);
const slugs = { a: `http-a-${run}`, b: `http-b-${run}` };
const tokens = { a: `token-a-${randomUUID()}`, b: `token-b-${randomUUID()}` };
const fake = new FakeProvider().when('processEpisode', 'Paris', {
  importance: 0.6,
  candidates: [aboutSelf('lives_in', 'Paris', { statement: 'The user lives in Paris.' })],
});
const handler = createEngramHttpHandler({
  db,
  provider: fake,
  tokens: new Map([
    [tokens.a, slugs.a],
    [tokens.b, slugs.b],
  ]),
  log: () => undefined,
  reportsDir: null,
});

afterAll(async () => {
  await handler.close();
  await db`delete from namespaces where slug in ${db([slugs.a, slugs.b])}`;
  await db.end();
});

const URL_ = new URL('http://engram.test/api/mcp');

interface ToolResult {
  content: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

async function clientFor(token: string) {
  const client = new Client({ name: 'engram-http-test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(URL_, {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
      // In-process: the handler answers, no port and no network.
      fetch: (url, init) => handler.fetch(new Request(url, init)),
    }),
  );
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as ToolResult;
  return { client, call };
}

const initialize = (authorization?: string) =>
  handler.fetch(
    new Request(URL_, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 't', version: '0' },
        },
      }),
    }),
  );

describe('the HTTP handler', () => {
  it('answers 401 without a known bearer token, before building a server', async () => {
    for (const auth of [undefined, 'Bearer nope', `Basic ${tokens.a}`, `Bearer ${tokens.a}x`]) {
      const r = await initialize(auth);
      expect(r.status, String(auth)).toBe(401);
      expect(r.headers.get('www-authenticate')).toBe('Bearer');
    }
    const [row] = await db<{ n: number }[]>`
      select count(*)::int as n from namespaces where slug in ${db([slugs.a, slugs.b])}`;
    expect(row?.n).toBe(0);
  });

  it('serves the 2025 protocol statelessly for older clients', async () => {
    const r = await initialize(`Bearer ${tokens.a}`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('"serverInfo"');
  });

  it("keeps each token's namespace to itself, even given another namespace's ids", async () => {
    const a = await clientFor(tokens.a);
    const b = await clientFor(tokens.b);

    const stored = await a.call('engram_remember', { content: 'I live in Paris.' });
    expect(stored.structuredContent).toMatchObject({
      status: 'processed',
      outcomes: { inserted: 1 },
    });
    const history = await a.call('engram_history', { entity: 'user' });
    const [fact] = history.structuredContent?.entries as { fact_id: string }[];
    const paris = await a.call('engram_entities', { query: 'paris' });
    const [entity] = paris.structuredContent?.entities as { id: string }[];
    expect(fact?.fact_id).toBeDefined();
    expect(entity?.id).toBeDefined();

    const recall = await b.call('engram_recall', { query: 'the user lives in Paris' });
    expect(recall.structuredContent?.memories).toEqual([]);
    expect((await b.call('engram_history', { entity: 'user' })).content[0]?.text).toBe(
      'No facts about the user.',
    );
    const byId = await b.call('engram_history', { entity: entity?.id });
    expect(byId.isError).toBe(true);
    expect(
      (await b.call('engram_entities', { query: 'paris' })).structuredContent?.entities,
    ).toEqual([]);
    const forget = await b.call('engram_forget', { fact_id: fact?.fact_id, mode: 'retract' });
    expect(forget).toMatchObject({ isError: true });

    // A's fact is untouched, and stats name each caller's own namespace.
    const again = await a.call('engram_history', { entity: 'user' });
    expect((again.structuredContent?.entries as { status: string }[]).map((e) => e.status)).toEqual(
      ['active'],
    );
    const stats = async (c: Client) => {
      const r = await c.readResource({ uri: 'engram://stats' });
      const [first] = r.contents;
      return JSON.parse(first && 'text' in first ? first.text : '{}') as { namespace: string };
    };
    expect((await stats(a.client)).namespace).toBe(slugs.a);
    expect((await stats(b.client)).namespace).toBe(slugs.b);
    await a.client.close();
    await b.client.close();
  });
});
