import { describe, expect, it } from 'vitest';
import { sseEvents, streamChat } from './sse-client';
import type { ChatEvent } from './sse-client';

const enc = new TextEncoder();
function stream(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const x of chunks) c.enqueue(enc.encode(x));
      c.close();
    },
  });
}
const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const fetchReturning = (res: Response) => (() => Promise.resolve(res)) as unknown as typeof fetch;

const memories = sse('memories', { abstained: false, memories: [] });
const answer = sse('answer', { text: 'You live in Lisbon.', supported: true, used_memory_ids: [] });
const done = sse('done', { episode_ids: ['a', 'b'] });

describe('sseEvents', () => {
  it('reassembles events split at any byte', async () => {
    const whole = memories + answer + done;
    const chunks = [whole.slice(0, 7), whole.slice(7, 40), whole.slice(40, 41), whole.slice(41)];
    const out: string[] = [];
    for await (const e of sseEvents(stream(chunks))) out.push(e.event);
    expect(out).toEqual(['memories', 'answer', 'done']);
  });
});

describe('streamChat', () => {
  it('delivers events in order and ends done', async () => {
    const seen: ChatEvent['event'][] = [];
    const outcome = await streamChat(
      { message: 'hi', session_id: 'a' },
      (e) => seen.push(e.event),
      {
        fetch: fetchReturning(new Response(stream([memories, answer, done]))),
      },
    );
    expect(outcome).toEqual({ kind: 'done' });
    expect(seen).toEqual(['memories', 'answer', 'done']);
  });

  it('reports a 429 as a limit, with the server message', async () => {
    const outcome = await streamChat({ message: 'hi', session_id: 'a' }, () => undefined, {
      fetch: fetchReturning(Response.json({ error: 'quota', limit: 'global' }, { status: 429 })),
    });
    expect(outcome).toEqual({ kind: 'limited', limit: 'global', message: 'quota' });
  });

  it('reports a stream that ends without done as interrupted', async () => {
    const outcome = await streamChat({ message: 'hi', session_id: 'a' }, () => undefined, {
      fetch: fetchReturning(new Response(stream([memories]))),
    });
    expect(outcome.kind).toBe('failed');
  });

  it('reports an error event as a failure with its message', async () => {
    const outcome = await streamChat({ message: 'hi', session_id: 'a' }, () => undefined, {
      fetch: fetchReturning(new Response(stream([sse('error', { error: 'The turn failed.' })]))),
    });
    expect(outcome).toEqual({ kind: 'failed', message: 'The turn failed.' });
  });
});
