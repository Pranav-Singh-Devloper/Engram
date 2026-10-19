// Records real Gemini responses for the P02 fixture conversations. Manual and
// deliberate: re-recording changes what the golden tests replay, so review
// the fixture diffs.
//
//   pnpm fixtures:record              re-record only stale fixtures (the default)
//   pnpm fixtures:record --all        re-record every fixture
//   pnpm fixtures:record 07-alias ... re-record the named fixtures
//
// A fixture is stale when its recorded calls no longer replay: the prompt
// version changed, or the pipeline now asks the model something different
// (e.g. a new predicate list). Checking is offline, so fresh fixtures cost no
// quota (free Gemini allows 500 requests a day).
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_DATABASE_URL,
  GeminiProvider,
  PROMPT_VERSION,
  createDb,
  ensureNamespace,
  geminiKeysFromEnv,
  ingest,
  processEpisode,
} from '@engram/core';
import type { Provider, Sql } from '@engram/core';
import {
  loadConversations,
  recordingProvider,
  replayProvider,
  saveConversation,
} from '@engram/core/testing';
import type { FixtureConversation, RecordedCall } from '@engram/core/testing';

const envFile = path.resolve(import.meta.dirname, '../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

/** Runs a conversation through the write path in a throwaway namespace. */
async function play(db: Sql, provider: Provider, conversation: FixtureConversation): Promise<void> {
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
}

async function isStale(db: Sql, conversation: FixtureConversation): Promise<boolean> {
  const { recording } = conversation;
  if (recording?.promptVersion !== PROMPT_VERSION) return true;
  try {
    await play(db, replayProvider(recording), conversation);
    return false;
  } catch {
    return true;
  }
}

async function main(): Promise<void> {
  // These are Gemini's goldens; local-model snapshots belong in expected-local/ (P11, ledger row 39).
  if ((process.env.ENGRAM_PROVIDER ?? 'gemini') !== 'gemini') {
    throw new Error('fixtures:record records the Gemini goldens; unset ENGRAM_PROVIDER.');
  }
  const model = process.env.GEMINI_CHAT_MODEL;
  if (!model) throw new Error('Set GEMINI_CHAT_MODEL to record fixtures.');
  const gemini = new GeminiProvider({
    ...geminiKeysFromEnv(process.env),
    chatModel: model,
    onKeySwitch: (i, _reason, lane) => {
      console.error(`gemini ${lane}: key ${i - 1} is out of quota; now on key ${i}`);
    },
  });
  const args = process.argv.slice(2);
  const named = new Set(args.filter((a) => !a.startsWith('--')));
  const all = args.includes('--all');
  const db = createDb(process.env.DATABASE_URL || DEFAULT_DATABASE_URL, { max: 2 });

  try {
    for (const conversation of loadConversations()) {
      if (
        named.size > 0 ? !named.has(conversation.id) : !all && !(await isStale(db, conversation))
      ) {
        if (named.size === 0) console.log(`${conversation.id}: fresh, skipped`);
        continue;
      }
      const calls: RecordedCall[] = [];
      await play(db, recordingProvider(gemini, calls), conversation);
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
