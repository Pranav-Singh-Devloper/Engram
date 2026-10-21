'use client';

import { Loader2, MessageSquarePlus, Pencil, Send, ShieldAlert } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { streamChat } from '@/lib/sse-client';
import type { ChatMemory } from '@/lib/sse-client';
import { cn } from '@/lib/utils';
import { MemoryCard } from './memory-card';
import {
  browserStore,
  createSession,
  loadMessages,
  loadState,
  renameSession,
  saveMessages,
  selectSession,
} from './sessions';
import type { ChatMessage, SessionsState, Store } from './sessions';

type Ready = { kind: 'starting' } | { kind: 'ready' } | { kind: 'blocked'; message: string };

export function Playground() {
  const store = useRef<Store | null>(null);
  const [state, setState] = useState<SessionsState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<Ready>({ kind: 'starting' });
  const [renaming, setRenaming] = useState<string | null>(null);
  const [panel, setPanel] = useState<{ memories: ChatMemory[]; used: string[] } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const still = useReducedMotion();

  // Browser-only state loads after mount, so server and client render the same first frame.
  useEffect(() => {
    store.current = browserStore();
    const s = loadState(store.current);
    setState(s);
    setMessages(loadMessages(store.current, s.current));
    api
      .demoSession()
      .then(() => {
        setReady({ kind: 'ready' });
      })
      .catch((err: unknown) => {
        setReady({
          kind: 'blocked',
          message: err instanceof ApiError ? err.message : 'Could not start a demo session.',
        });
      });
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'end' });
  }, [messages, still]);

  const current = state?.current ?? '';
  const persist = useCallback(
    (next: ChatMessage[]) => {
      setMessages(next);
      if (store.current && current) saveMessages(store.current, current, next);
    },
    [current],
  );

  const switchTo = (id: string) => {
    if (!store.current || !state) return;
    const s = selectSession(store.current, state, id);
    setState(s);
    setMessages(loadMessages(store.current, id));
    setPanel(null);
  };

  async function send() {
    const text = draft.trim();
    if (!text || busy || ready.kind !== 'ready' || !current) return;
    setDraft('');
    setBusy(true);
    let log: ChatMessage[] = [...messages, { role: 'user', text }];
    persist(log);
    let recalled: ChatMemory[] = [];
    let abstained = false;
    const outcome = await streamChat({ message: text, session_id: current }, (e) => {
      if (e.event === 'memories') {
        recalled = e.data.memories;
        abstained = e.data.abstained;
        setPanel({ memories: recalled, used: [] });
      } else if (e.event === 'answer') {
        log = [
          ...log,
          {
            role: 'assistant',
            text: e.data.text,
            supported: e.data.supported,
            memories: recalled,
            used: e.data.used_memory_ids,
            abstained,
          },
        ];
        persist(log);
        setPanel({ memories: recalled, used: e.data.used_memory_ids });
      }
    });
    if (outcome.kind !== 'done') {
      persist([
        ...log,
        {
          role: 'notice',
          text: outcome.message,
          tone: outcome.kind === 'limited' ? 'limit' : 'error',
        },
      ]);
    }
    setBusy(false);
  }

  const sessions = state?.sessions ?? [];
  const lastUsed = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.role === 'assistant') return { memories: m.memories ?? [], used: m.used ?? [] };
    }
    return null;
  }, [messages]);
  const shown = panel ?? lastUsed;

  return (
    <div className="mx-auto grid max-w-6xl gap-4 px-4 py-4 lg:grid-cols-[220px_1fr_320px]">
      <aside className="order-2 lg:order-1">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Sessions
          </h2>
          <button
            type="button"
            aria-label="New session"
            onClick={() => {
              if (!store.current || !state) return;
              const s = createSession(store.current, state);
              setState(s);
              setMessages([]);
              setPanel(null);
            }}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <MessageSquarePlus className="size-4" />
          </button>
        </div>
        <ul className="flex gap-1 overflow-x-auto lg:flex-col">
          {sessions.map((s) => (
            <li key={s.id} className="shrink-0">
              {renaming === s.id ? (
                <input
                  autoFocus
                  defaultValue={s.name}
                  aria-label="Session name"
                  className="w-40 rounded-md border bg-background px-2 py-1 text-sm lg:w-full"
                  onBlur={(e) => {
                    if (store.current && state)
                      setState(renameSession(store.current, state, s.id, e.target.value));
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <div
                  className={cn(
                    'group flex items-center gap-1 rounded-md px-2 py-1 text-sm',
                    s.id === current
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <button
                    type="button"
                    className="truncate text-left"
                    onClick={() => {
                      switchTo(s.id);
                    }}
                  >
                    {s.name}
                  </button>
                  <button
                    type="button"
                    aria-label={`Rename ${s.name}`}
                    onClick={() => {
                      setRenaming(s.id);
                    }}
                    className="ml-auto opacity-0 group-hover:opacity-100 focus:opacity-100"
                  >
                    <Pencil className="size-3" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-4 hidden text-xs leading-relaxed text-muted-foreground lg:block">
          Tell it something in one session, then ask about it in another. Each session is a separate
          conversation; the memory is shared.
        </p>
      </aside>

      <section className="order-1 flex min-h-[70dvh] flex-col rounded-lg border bg-card lg:order-2">
        <div className="flex items-start gap-2 border-b px-4 py-2.5 text-xs text-muted-foreground">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-record" />
          <p>
            Don’t enter personal data. This demo runs on Gemini’s free tier, whose inputs may be
            used to improve Google’s products. Demo memory is deleted after 24 hours.
          </p>
        </div>
        <ol className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
          {messages.length === 0 && ready.kind !== 'blocked' && (
            <li className="mx-auto mt-10 max-w-sm text-center text-sm text-muted-foreground">
              Try: “I live in Lisbon and work at Acme.” Then open a new session and ask “Where do I
              work?”
            </li>
          )}
          <AnimatePresence initial={false}>
            {messages.map((m, i) => (
              <motion.li
                key={i}
                layout={!still}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={still ? { duration: 0 } : { duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                <div
                  className={cn(
                    'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
                    m.role === 'user' && 'bg-accent text-accent-foreground',
                    m.role === 'assistant' && 'bg-muted',
                    m.role === 'notice' && 'border border-danger/40 bg-danger/10 text-foreground',
                  )}
                >
                  {m.text}
                  {m.role === 'assistant' && (
                    <button
                      type="button"
                      onClick={() => {
                        setPanel({ memories: m.memories ?? [], used: m.used ?? [] });
                      }}
                      className="mt-1 block font-mono text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      {m.supported === false
                        ? 'no memory supported an answer · your message is stored'
                        : `used ${String(m.used?.length ?? 0)} of ${String(m.memories?.length ?? 0)} recalled`}
                    </button>
                  )}
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
          {busy && (
            <li className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> recalling and composing…
            </li>
          )}
          {ready.kind === 'blocked' && (
            <li className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm">
              {ready.message}
            </li>
          )}
          <div ref={bottom} />
        </ol>
        <form
          className="flex items-end gap-2 border-t p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            maxLength={2000}
            placeholder={
              ready.kind === 'ready' ? 'Tell it something, or ask…' : 'Starting a demo session…'
            }
            disabled={ready.kind !== 'ready'}
            className="max-h-40 min-h-10 flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={busy || !draft.trim() || ready.kind !== 'ready'}
            className="inline-flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground transition-opacity disabled:opacity-40"
          >
            <Send className="size-4" />
          </button>
        </form>
      </section>

      <aside className="order-3" aria-label="Memories used">
        <h2 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Memories
        </h2>
        {shown && shown.memories.length > 0 ? (
          <ul className="space-y-2">
            {[...shown.memories]
              .sort((a, b) => Number(shown.used.includes(b.id)) - Number(shown.used.includes(a.id)))
              .map((m) => (
                <MemoryCard key={m.id} m={m} used={shown.used.includes(m.id)} />
              ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            The memories each answer recalls show here, with the ones it actually used highlighted.
          </p>
        )}
      </aside>
    </div>
  );
}
