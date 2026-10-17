// P08b's guarantee: in local mode Engram's own processing makes no request
// beyond loopback. A stub Ollama on 127.0.0.1 stands in for the model (CI has
// none); global fetch is wrapped to fail on any other host. Node's fetch
// ignores HTTP(S)_PROXY, so proxy variables could never prove this.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fakeEmbedding, ingest, processEpisode, providerFromEnv } from '@engram/core';
import { testDb, withTestNamespace } from '@engram/core/testing';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEngramServer } from './server.js';

const db = testDb();
const hint = {
  kind: 'none',
  date: null,
  amount: null,
  unit: null,
  direction: null,
  year: null,
  month: null,
  season: null,
};

/** Replies the way Ollama would, keyed off which Engram prompt it was sent. */
function reply(system: string): unknown {
  if (system.includes('one conversation turn')) {
    return {
      importance: 0.6,
      candidates: [
        {
          subject: { name: 'SELF', type: 'person', description: null },
          predicate: 'lives_in',
          objectKind: 'entity',
          objectName: 'Lisbon',
          objectType: 'place',
          objectDescription: 'a city in Portugal',
          statement: 'The user lives in Lisbon.',
          validFrom: hint,
          validTo: hint,
          isCorrection: false,
          confidence: 0.9,
        },
      ],
    };
  }
  if (system.includes('consolidate'))
    return { summary: 'The user lives in Lisbon.', candidates: [] };
  return { answer: 'Lisbon', supported: true, usedMemoryIds: [] };
}

const outside: string[] = [];
const realFetch = globalThis.fetch;
let stubUrl = '';
let close: () => void = () => undefined;

beforeAll(async () => {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      const json = body ? (JSON.parse(body) as Record<string, unknown>) : {};
      if (req.url === '/api/tags') {
        res.end(
          JSON.stringify({ models: [{ name: 'embeddinggemma:300m', digest: 'stubdigest00000' }] }),
        );
      } else if (req.url === '/api/embed') {
        res.end(JSON.stringify({ embeddings: (json.input as string[]).map(fakeEmbedding) }));
      } else if (req.url === '/api/chat') {
        const [system] = json.messages as { content: string }[];
        const content = JSON.stringify(reply(system?.content ?? ''));
        res.end(
          `${JSON.stringify({ message: { content } })}\n${JSON.stringify({ done: true, eval_count: 1 })}\n`,
        );
      } else {
        res.statusCode = 404;
        res.end('{}');
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  stubUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
  // The guard: every request that isn't to loopback is recorded and refused.
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      outside.push(url.host);
      return Promise.reject(new Error(`blocked outside request to ${url.host}`));
    }
    return realFetch(input, init);
  };
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  close();
  await db.end();
});

const localEnv = () => ({ ENGRAM_PROVIDER: 'ollama', OLLAMA_BASE_URL: stubUrl });

describe('local mode makes no outside requests', () => {
  it('remember → process → recall → entities → consolidate → stats, all on loopback', async () => {
    await withTestNamespace(db, async (ns) => {
      const provider = providerFromEnv(localEnv());
      const server = createEngramServer({
        db,
        provider,
        namespaceId: ns.namespace.id,
        log: () => undefined,
        reportsDir: null,
      });
      const [a, b] = InMemoryTransport.createLinkedPair();
      await server.connect(a);
      const client = new Client({ name: 'egress', version: '0' });
      await client.connect(b);
      const call = (name: string, args: Record<string, unknown> = {}) =>
        client.callTool({ name, arguments: args });

      const stored = (await call('engram_remember', { content: 'I live in Lisbon.' })) as {
        structuredContent?: Record<string, unknown>;
      };
      expect(stored.structuredContent).toMatchObject({
        status: 'processed',
        outcomes: { inserted: 1 },
      });
      await call('engram_recall', { query: 'where does the user live' });
      await call('engram_entities', { query: 'Lisbon' });
      await call('engram_history', { entity: 'user' });
      await call('engram_consolidate');
      await client.readResource({ uri: 'engram://stats' });
      // Bulk paths too.
      const e = await ingest(db, provider, {
        namespaceId: ns.namespace.id,
        sessionId: 's2',
        role: 'user',
        content: 'I live in Lisbon.',
      });
      await processEpisode(db, provider, e.id);
      expect(outside).toEqual([]);
    });
  });

  it('catches a remote call (mutation check: Gemini embeddings slip in)', async () => {
    await withTestNamespace(db, async (ns) => {
      const provider = providerFromEnv(
        { ...localEnv(), OLLAMA_EMBEDDINGS: 'gemini', GEMINI_API_KEY: 'x' },
        // Fail on the first refusal instead of backing off for ~30 s.
        { retry: { maxRetries: 0 } },
      );
      await expect(
        ingest(db, provider, {
          namespaceId: ns.namespace.id,
          sessionId: 's',
          role: 'user',
          content: 'hi',
        }),
      ).rejects.toThrow();
      expect(outside).toContain('generativelanguage.googleapis.com');
      outside.length = 0;
    });
  });
});
