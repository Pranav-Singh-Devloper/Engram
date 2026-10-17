// The stdio binary for local clients (Claude Code, Claude Desktop, Cursor).
// stdout carries the protocol and nothing else: every diagnostic goes to stderr.
//
//   ENGRAM_NAMESPACE=me packages/mcp/node_modules/.bin/tsx packages/mcp/src/stdio.ts
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_DATABASE_URL,
  GeminiProvider,
  createDb,
  ensureNamespace,
  geminiKeysFromEnv,
  processPending,
} from '@engram/core';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { namespaceSlug } from './env.js';
import { createEngramServer } from './server.js';

const log = (message: string) => {
  process.stderr.write(`engram-mcp: ${message}\n`);
};

async function main(): Promise<void> {
  const envFile = path.resolve(import.meta.dirname, '../../../.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const env = process.env;

  const keys = geminiKeysFromEnv(env);
  if (!keys.apiKey) throw new Error('GEMINI_API_KEY is not set (in the client config or .env).');
  const provider = new GeminiProvider({
    ...keys,
    chatModel: env.GEMINI_CHAT_MODEL || 'gemini-3.5-flash-lite',
    embedModel: env.GEMINI_EMBED_MODEL || undefined,
    onKeySwitch: (i) => {
      log(`main key's quota is exhausted; switched to fallback key ${i}`);
    },
  });
  const db = createDb(env.DATABASE_URL || DEFAULT_DATABASE_URL, { max: 4 });
  const slug = namespaceSlug(env);
  const { namespace } = await ensureNamespace(db, { slug, kind: 'user' });
  log(`serving namespace "${slug}"`);

  serveStdio(() => createEngramServer({ db, provider, namespaceId: namespace.id, log }));

  // Finish anything a previous session left unprocessed (wait: false, a crash).
  void processPending(db, provider, { namespaceId: namespace.id }).then(
    (r) => {
      if (r.processed > 0 || r.error) {
        log(`processed ${r.processed} pending episode(s)${r.error ? `; stopped: ${r.error}` : ''}`);
      }
    },
    (err: unknown) => {
      log(`pending processing failed: ${String(err)}`);
    },
  );

  // Exit when the client closes stdin, releasing the database pool.
  process.stdin.on('end', () => {
    void db.end({ timeout: 2 }).finally(() => process.exit(0));
  });
}

main().catch((err: unknown) => {
  log(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
