// Records real Gemini responses for the P02 fixture conversations. Manual and
// deliberate: re-recording changes what the golden tests replay, so review
// the fixture diffs. Usage: pnpm fixtures:record [fixture-id ...]
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_DATABASE_URL,
  GeminiProvider,
  PROMPT_VERSION,
  createDb,
  ensureNamespace,
  ingest,
  processEpisode,
} from '@engram/core';
import { loadConversations, recordingProvider, saveConversation } from '@engram/core/testing';
import type { RecordedCall } from '@engram/core/testing';

const envFile = path.resolve(import.meta.dirname, '../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

async function main(): Promise<void> {
  const model = process.env.GEMINI_CHAT_MODEL;
  if (!model) throw new Error('Set GEMINI_CHAT_MODEL to record fixtures.');
  const gemini = new GeminiProvider({ apiKey: process.env.GEMINI_API_KEY ?? '', chatModel: model });
  const only = new Set(process.argv.slice(2));
  const db = createDb(process.env.DATABASE_URL || DEFAULT_DATABASE_URL, { max: 2 });

  try {
    for (const conversation of loadConversations()) {
      if (only.size > 0 && !only.has(conversation.id)) continue;
      const calls: RecordedCall[] = [];
      const provider = recordingProvider(gemini, calls);
      const { namespace } = await ensureNamespace(db, {
        slug: `fixture-record-${conversation.id}-${randomUUID()}`,
        kind: 'bench',
      });
      try {
        for (const ep of conversation.episodes) {
          const episode = await ingest(db, provider, {
            namespaceId: namespace.id,
            sessionId: ep.sessionId,
            role: ep.role,
            content: ep.content,
            occurredAt: new Date(ep.occurredAt),
          });
          await processEpisode(db, provider, episode.id);
        }
      } finally {
        await db`delete from namespaces where id = ${namespace.id}`;
      }
      saveConversation({
        ...conversation,
        recording: {
          promptVersion: PROMPT_VERSION,
          model,
          recordedAt: new Date().toISOString(),
          calls,
        },
      });
      console.log(`${conversation.id}: ${calls.length} call(s) recorded`);
    }
  } finally {
    await db.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
