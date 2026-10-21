// Reads POST /api/chat's server-sent events (ADR-019): `memories`, then
// `answer`, then `done`, or `error`. A refused turn is a 429 with JSON
// before any stream; a stream that ends without `done` is reported as
// interrupted, never as a silent success.
import { z } from 'zod';

export const ChatMemory = z.object({
  id: z.string(),
  kind: z.enum(['fact', 'episode']),
  text: z.string(),
  status: z.string().nullable(),
  valid_from: z.coerce.date(),
  valid_to: z.coerce.date().nullable(),
  source_episode_ids: z.array(z.string()),
});
export type ChatMemory = z.infer<typeof ChatMemory>;

export const ChatEvent = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('memories'),
    data: z.object({ abstained: z.boolean(), memories: z.array(ChatMemory) }),
  }),
  z.object({
    event: z.literal('answer'),
    data: z.object({
      text: z.string(),
      supported: z.boolean(),
      used_memory_ids: z.array(z.string()),
    }),
  }),
  z.object({ event: z.literal('done'), data: z.object({ episode_ids: z.array(z.string()) }) }),
  z.object({ event: z.literal('error'), data: z.object({ error: z.string() }) }),
]);
export type ChatEvent = z.infer<typeof ChatEvent>;

export type ChatOutcome =
  | { kind: 'done' }
  | { kind: 'limited'; limit: 'namespace' | 'global'; message: string }
  | { kind: 'failed'; message: string };

/** Splits an SSE byte stream into named events, across arbitrary chunk boundaries. */
export async function* sseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const event = /^event: (.*)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (event && data !== undefined) yield { event, data };
    }
  }
}

export async function streamChat(
  input: { message: string; session_id: string },
  onEvent: (e: ChatEvent) => void,
  options: { signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<ChatOutcome> {
  const f = options.fetch ?? fetch;
  let res: Response;
  try {
    res = await f('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      credentials: 'same-origin',
      signal: options.signal,
    });
  } catch {
    return { kind: 'failed', message: 'Could not reach the server.' };
  }
  if (res.status === 429) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; limit?: string };
    return {
      kind: 'limited',
      limit: body.limit === 'global' ? 'global' : 'namespace',
      message: body.error ?? 'Too many messages. Try again later.',
    };
  }
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: 'failed', message: body.error ?? `The server answered ${String(res.status)}.` };
  }
  try {
    for await (const raw of sseEvents(res.body)) {
      const parsed = ChatEvent.safeParse({
        event: raw.event,
        data: JSON.parse(raw.data) as unknown,
      });
      if (!parsed.success) continue;
      onEvent(parsed.data);
      if (parsed.data.event === 'done') return { kind: 'done' };
      if (parsed.data.event === 'error') return { kind: 'failed', message: parsed.data.data.error };
    }
  } catch {
    // An aborted or broken connection falls through to "interrupted".
  }
  return { kind: 'failed', message: 'The reply was interrupted. Please try again.' };
}
