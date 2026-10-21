# The Engram demo (about 5 minutes)

A script anyone can follow on the hosted demo or a local checkout. It shows the four things Engram exists for:
1. memory across sessions;
2. a fact that changes;
3. a fact that's corrected;
4. the difference between *when something was true* and *when Engram believed it*.

Walked end to end on 2026-10-21 in a real browser against the local app on Gemini (P09b task 7). The answers below are what it said.

**Before you start:** open `/chat`. The app creates a private demo session for you (a cookie; deleted after 24 hours). Don't type personal data: the demo runs on Gemini's free tier.

## 1. Tell it something (session 1)

Type:

> I live in Paris and work at Initech.

The reply has no memory to draw on yet (typically "I don't know."), and the caption under it says *no memory supported an answer · your message is stored*. That's expected: you told it something; you didn't ask. Your message is stored at once. Facts are extracted in the background, which takes a few seconds on Gemini.

## 2. Ask from a different conversation (session 2)

Click **+** next to *Sessions* to open session 2, and ask:

> Where do I live?

**Expected:** "You live in Paris." The *Memories* panel shows what it recalled; the one it used is highlighted. This is cross-session recall: session 2 never heard about Paris.

## 3. Change a fact, and correct one (still session 2)

> I just moved to Berlin.

> Actually, I work at Acme, not Initech.

Say the move in the present ("I just moved"), not with a past date. Everything in this demo happens within minutes. If you say "I moved to Berlin in March", Berlin's start lands *before* today's Paris, and Engram correctly records Berlin as earlier history that Paris replaced. Seen in the walk-through: a local 9B model even dated "just moved" to yesterday, with the same effect.

## 4. Ask again (session 3)

Open session 3:

> Where do I live and where do I work?

**Expected:** "You live in Berlin and work at Acme."

## 5. Watch the timeline

In the *Memories* panel, click **timeline ↗** on either fact. On the timeline page:

1. Turn on **Show record-time history**. Every version appears:
   - Paris, closed when Berlin started;
   - Berlin, open (→);
   - Initech, **hatched**: retracted, not just ended;
   - Acme, open.
2. Drag **known at** all the way left, to the moment of your first message. The *canonical query* box now answers **"The user lives in Paris."** That's what Engram believed then.
3. Drag it back right to now: **"The user lives in Berlin. The user works at Acme."**

That's the bitemporal model: the same question ("where does the user live, valid now?") answered as of two different moments of knowledge. Nothing was overwritten. Every belief Engram ever held is still there, with the time it held it.

## Also worth a look

- **`/memories`**: every fact ranked by retention score (how likely it is to survive decay). Expand a row to see the turn it came from.
- **`/evals`**: the benchmarks, losses included.

## If something looks off

- **"The demo has used today's free model quota":** the global daily cap (120 turns) was reached. The rest of the site still works; try again tomorrow.
- **An answer misses a fact you just stated:** extraction runs after the reply. Give it a few seconds and ask again. On local models (`docs/local.md`) it can take a minute or two.
