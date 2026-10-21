import { describe, expect, it } from 'vitest';
import {
  MAX_MESSAGES,
  createSession,
  loadState,
  renameSession,
  saveMessages,
  loadMessages,
} from './sessions';
import type { Store } from './sessions';

function memoryStore(): Store {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
}

describe('chat sessions', () => {
  it('starts with one session and creates more with server-valid ids', () => {
    const s = memoryStore();
    const first = loadState(s);
    expect(first.sessions).toHaveLength(1);
    const next = createSession(s, first);
    expect(next.sessions).toHaveLength(2);
    expect(next.current).toBe(next.sessions[1]?.id);
    for (const x of next.sessions) expect(x.id).toMatch(/^[\w-]{1,64}$/);
    expect(next.sessions[1]?.name).toBe('Session 2');
  });

  it('renames with trimming and a length cap, keeping the old name when blank', () => {
    const s = memoryStore();
    const st = loadState(s);
    const id = st.sessions[0]?.id ?? '';
    expect(renameSession(s, st, id, '  Work  ').sessions[0]?.name).toBe('Work');
    expect(renameSession(s, st, id, '   ').sessions[0]?.name).toBe(st.sessions[0]?.name);
    expect(renameSession(s, st, id, 'x'.repeat(200)).sessions[0]?.name).toHaveLength(60);
  });

  it('survives corrupt storage and keeps only the newest messages', () => {
    const s = memoryStore();
    s.set('engram-chat-sessions', '{not json');
    expect(loadState(s).sessions).toHaveLength(1);
    const many = Array.from({ length: MAX_MESSAGES + 5 }, (_, i) => ({
      role: 'user' as const,
      text: String(i),
    }));
    saveMessages(s, 'a', many);
    const kept = loadMessages(s, 'a');
    expect(kept).toHaveLength(MAX_MESSAGES);
    expect(kept[0]?.text).toBe('5');
  });
});
