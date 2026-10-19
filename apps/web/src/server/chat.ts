// POST /api/chat (SPEC §11, §6.1, §6.3; P09a decision 7). One demo turn:
// limits first, then recall, store the user's turn, compose from recalled
// memories only, store the reply, record use of the memories the composer
// used, and extract facts from both turns after the response is sent.
import { ingest, processEpisode, recall, trackUse } from '@engram/core';
import type { Clock, Provider, Sql } from '@engram/core';
import { z } from 'zod';
import type { Access } from './auth';
import { takeChatTurn } from './limits';
import { eventStream } from './sse';

const ChatBody = z.object({
  message: z.string().trim().min(1).max(2000),
  /** The visitor's session (the UI's session switcher); names stay client-side. */
  session_id: z
    .string()
    .trim()
    .regex(/^[\w-]{1,64}$/),
});

export interface ChatDeps {
  db: Sql;
  provider: Provider;
  clock: Clock;
  defer: (task: () => Promise<void>) => void;
  dailyTurnCap: number;
}

export const CAP_MESSAGE =
  "The demo has used today's free model quota. Try again tomorrow; the showcase is still available.";

/** What the composer sees for a turn, as in the bench: assistant turns are labelled. */
const spoken = (role: string | null, text: string) =>
  role === 'assistant' ? `assistant: ${text}` : text;

export async function chat(deps: ChatDeps, access: Access, req: Request): Promise<Response> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: 'The body must be JSON.' }, { status: 400 });
  }
  const parsed = ChatBody.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid body.', issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }
  const { message, session_id } = parsed.data;
  const { db, provider, clock } = deps;

  // Limits refuse before any model call, with a plain 429 rather than a stream.
  const verdict = await takeChatTurn(db, access.namespaceId, deps.dailyTurnCap, clock.now());
  if (verdict !== 'ok') {
    return Response.json(
      verdict === 'global'
        ? { error: CAP_MESSAGE, limit: 'global' }
        : {
            error: 'This demo session has reached 30 messages this hour. Try again later.',
            limit: 'namespace',
          },
      { status: 429 },
    );
  }

  // Registered now, while the request is being handled; it runs once the
  // stream has closed and the stored episodes are known.
  let stored: (ids: string[]) => void = () => undefined;
  const episodes = new Promise<string[]>((resolve) => (stored = resolve));
  deps.defer(async () => {
    for (const id of await episodes) await processEpisode(db, provider, id, { clock });
  });

  const sessionId = `chat-${session_id}`;
  return eventStream(async ({ send }) => {
    const ids: string[] = [];
    try {
      // Recall first: the turn being asked must not come back as a memory of
      // itself (it would match at similarity 1 and defeat the abstention floor).
      const r = await recall(
        db,
        provider,
        { namespaceId: access.namespaceId, query: message, trackAccess: false },
        clock,
      );
      const memories = r.memories;
      send('memories', {
        abstained: r.abstained,
        memories: memories.map((m) => ({
          id: m.id,
          kind: m.kind,
          text: m.text,
          status: m.status,
          valid_from: m.validFrom,
          valid_to: m.validTo,
          source_episode_ids: m.sourceEpisodeIds,
        })),
      });
      // Stored before composing, so the visitor's message survives a failed reply.
      const turn = await ingest(
        db,
        provider,
        {
          namespaceId: access.namespaceId,
          sessionId,
          role: 'user',
          content: message,
          occurredAt: clock.now(),
        },
        { clock },
      );
      ids.push(turn.id);
      const answer = await provider.compose({
        question: message,
        now: clock.now(),
        memories: memories.map((m) => ({
          id: m.id,
          kind: m.kind,
          text: m.kind === 'episode' ? spoken(m.role, m.text) : m.text,
          validFrom: m.validFrom,
          validTo: m.validTo,
        })),
      });
      send('answer', {
        text: answer.answer,
        supported: answer.supported,
        used_memory_ids: answer.usedMemoryIds,
      });
      const reply = await ingest(
        db,
        provider,
        {
          namespaceId: access.namespaceId,
          sessionId,
          role: 'assistant',
          content: answer.answer,
          occurredAt: clock.now(),
        },
        { clock },
      );
      ids.push(reply.id);
      // Only what the composer used counts as use (SPEC §6.2 rule 7; ledger row 21).
      const facts = new Set(memories.filter((m) => m.kind === 'fact').map((m) => m.id));
      await trackUse(
        db,
        answer.usedMemoryIds.filter((id) => facts.has(id)),
        clock,
      );
      send('done', { episode_ids: ids });
    } catch (err) {
      send('error', { error: 'The turn failed. Please try again.' });
      // The real cause goes to the function log, never to the visitor.
      console.error('chat turn failed:', err);
    } finally {
      stored(ids);
    }
  });
}
