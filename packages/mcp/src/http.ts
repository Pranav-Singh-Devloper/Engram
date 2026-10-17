// The stateless, bearer-authenticated HTTP transport (SPEC §10, §11). P09a
// mounts `fetch` at /api/mcp unchanged. Each token maps to one namespace; a
// request without a known token gets 401 before any server is built.
import { createHash, timingSafeEqual } from 'node:crypto';
import { ensureNamespace } from '@engram/core';
import { createMcpHandler } from '@modelcontextprotocol/server';
import type { McpHttpHandler } from '@modelcontextprotocol/server';
import { createEngramServer } from './server.js';
import type { EngramServerOptions } from './server.js';

export interface EngramHttpOptions extends Omit<EngramServerOptions, 'namespaceId'> {
  /** Bearer token → namespace slug (see `parseTokens`). */
  tokens: ReadonlyMap<string, string>;
}

export interface EngramHttpHandler {
  fetch: (request: Request) => Promise<Response>;
  close: () => Promise<void>;
}

const digest = (s: string) => createHash('sha256').update(s).digest();

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'A valid bearer token is required.' }), {
    status: 401,
    headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer' },
  });
}

export function createEngramHttpHandler(options: EngramHttpOptions): EngramHttpHandler {
  const { tokens, ...serverOptions } = options;
  const known = [...tokens].map(([token, slug]) => ({ digest: digest(token), slug }));
  /** Compares against every token in constant time, so timing reveals nothing. */
  const slugFor = (token: string): string | undefined => {
    const d = digest(token);
    let found: string | undefined;
    for (const k of known) if (timingSafeEqual(d, k.digest)) found = k.slug;
    return found;
  };

  const handlers = new Map<string, Promise<McpHttpHandler>>();
  const handlerFor = (slug: string) => {
    let h = handlers.get(slug);
    if (!h) {
      h = ensureNamespace(options.db, { slug, kind: 'user' }).then(({ namespace }) =>
        createMcpHandler(() => createEngramServer({ ...serverOptions, namespaceId: namespace.id })),
      );
      // A failed lookup isn't cached; the next request retries.
      h.catch(() => handlers.delete(slug));
      handlers.set(slug, h);
    }
    return h;
  };

  return {
    fetch: async (request) => {
      const token = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get('authorization') ?? '')?.[1];
      const slug = token === undefined ? undefined : slugFor(token);
      if (slug === undefined) return unauthorized();
      return (await handlerFor(slug)).fetch(request);
    },
    close: async () => {
      const all = await Promise.allSettled(handlers.values());
      for (const r of all) if (r.status === 'fulfilled') await r.value.close();
      handlers.clear();
    },
  };
}
