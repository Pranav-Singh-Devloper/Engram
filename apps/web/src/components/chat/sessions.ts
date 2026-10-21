// The chat's sessions live in the browser (ADR-019: names are UI state); the
// server only sees the id, which must match /^[\w-]{1,64}$/.
import type { ChatMemory } from '@/lib/sse-client';

export interface Store {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export interface Session {
  id: string;
  name: string;
  createdAt: string;
}

export interface SessionsState {
  sessions: Session[];
  current: string;
}

export type ChatMessage =
  | { role: 'user'; text: string }
  | {
      role: 'assistant';
      text: string;
      supported?: boolean;
      memories?: ChatMemory[];
      used?: string[];
      abstained?: boolean;
    }
  | { role: 'notice'; text: string; tone: 'limit' | 'error' };

const KEY = 'engram-chat-sessions';
export const MAX_MESSAGES = 100;
const NAME_MAX = 60;

const newId = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
  ).replace(/[^\w-]/g, '');

const fresh = (n: number): Session => ({
  id: newId(),
  name: `Session ${String(n)}`,
  createdAt: new Date().toISOString(),
});

function save(store: Store, state: SessionsState): SessionsState {
  try {
    store.set(KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked: the state still works for this page.
  }
  return state;
}

export function loadState(store: Store): SessionsState {
  try {
    const raw = store.get(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SessionsState;
      if (Array.isArray(parsed.sessions) && parsed.sessions.length > 0) {
        const valid = parsed.sessions.filter((s) => /^[\w-]{1,64}$/.test(s.id));
        if (valid.length > 0) {
          const current = valid.some((s) => s.id === parsed.current)
            ? parsed.current
            : (valid[0]?.id ?? '');
          return { sessions: valid, current };
        }
      }
    }
  } catch {
    // Corrupt storage: start over.
  }
  const s = fresh(1);
  return save(store, { sessions: [s], current: s.id });
}

export function createSession(store: Store, state: SessionsState): SessionsState {
  const s = fresh(state.sessions.length + 1);
  return save(store, { sessions: [...state.sessions, s], current: s.id });
}

export function selectSession(store: Store, state: SessionsState, id: string): SessionsState {
  return state.sessions.some((s) => s.id === id) ? save(store, { ...state, current: id }) : state;
}

export function renameSession(
  store: Store,
  state: SessionsState,
  id: string,
  name: string,
): SessionsState {
  const clean = name.trim().slice(0, NAME_MAX);
  if (clean === '') return state;
  return save(store, {
    ...state,
    sessions: state.sessions.map((s) => (s.id === id ? { ...s, name: clean } : s)),
  });
}

const messagesKey = (id: string) => `engram-chat:${id}`;

export function loadMessages(store: Store, id: string): ChatMessage[] {
  try {
    const raw = store.get(messagesKey(id));
    return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

export function saveMessages(store: Store, id: string, messages: ChatMessage[]): void {
  try {
    store.set(messagesKey(id), JSON.stringify(messages.slice(-MAX_MESSAGES)));
  } catch {
    // Full or blocked storage: the transcript stays in memory only.
  }
}

/** localStorage when it's usable; otherwise an in-memory stand-in. */
export function browserStore(): Store {
  try {
    const t = '__engram_probe__';
    localStorage.setItem(t, t);
    localStorage.removeItem(t);
    return {
      get: (k) => localStorage.getItem(k),
      set: (k, v) => {
        localStorage.setItem(k, v);
      },
    };
  } catch {
    const m = new Map<string, string>();
    return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
  }
}
