# P09a — Web API

**Status:** done (2026-10-19)

## Goal
Give the Next.js app its HTTP surface: thin route handlers over `packages/core`, P07's MCP server over streamable HTTP, and an anonymous demo flow (cookie namespaces, rate limits, a global daily cap) that can't exhaust the free Gemini quota. No pages: those are P09b.

## Spec refs
§11 (endpoints, demo flow, per-IP throttle, global daily cap, connection pooling), §10 (HTTP transport, bearer → namespace), §6.1 (post-response `process` in chat), §6.2 rule 7 (access tracking for used memories only), §6.3 (composition), §14 (Vercel Hobby), §15 P9.

## Depends on / unlocks
- **Depends on:** P07 (`createEngramServer`, `createEngramHttpHandler`, `parseTokens`). P08 isn't required; `/api/evals` reads whatever reports exist.
- **Unlocks:** P09b (pages call these endpoints), P10 (deploy, showcase seed).

## Research (2026-10-19)
- **Next.js** is at 16 (16.3 in canary in June 2026). `after()` from `next/server` runs a callback after the response is sent, works in route handlers, and is best-effort: no retries, no durable queue. The exact stable version is pinned at install time.
- **Vercel Hobby** with Fluid compute: 300 s default and maximum function duration, 1 vCPU / 2 GB. `after()` work counts toward that duration. The slowest `process()` call measured so far (Gemini, a turn with adjudication) takes seconds, well inside it. Hobby is for non-commercial use, which fits a portfolio project.
- **Neon** (ADR-014): the direct endpoint keeps the database's default `search_path` (set by `sql/hosted/0002`); the proxy drops the startup parameter, and the pooled endpoint resets the path. A free 0.25 CU compute takes about 100 connections.

## Decisions (for approval)
1. **One bearer model: `ENGRAM_MCP_TOKENS` for MCP and REST** (ledger row 33). Each token maps to one namespace slug, as MCP already does, and is compared in constant time. `ENGRAM_API_TOKEN` is removed from `.env.example` and SPEC §14. (`ENGRAM_NAMESPACE` stays: the stdio MCP server uses it. The first draft of this plan wrongly listed it for removal; corrected in task 3.) One auth model, and REST is namespace-scoped the same way MCP is.
2. **Chat streams events, not tokens.** `POST /api/chat` returns `text/event-stream`:
   - `memories`: what recall found, sent as soon as recall returns (under a second);
   - `answer`: `{text, supported, usedMemoryIds}`;
   - `done`, or `limit` / `error`.

   The composer returns zod-validated JSON (§6.3; CLAUDE.md requires validated LLM output), and `usedMemoryIds` is part of that object, so the answer can't be streamed token by token without unvalidated partial JSON. No AI SDK is needed. Token streaming stays possible later if P09b's UI needs it.
3. **Demo identity: a random cookie secret, a derived slug.** `POST /api/demo/session` makes a 128-bit random secret and sets it as the cookie (`httpOnly`, `Secure`, `SameSite=Lax`, 24 h). The namespace slug is `demo-` plus a hash of that secret. The database never holds the secret, so reading the database doesn't let anyone act as a visitor. Kind `demo`, `expires_at = now + 24 h`; `jobs:maintain` already deletes expired demo namespaces.
4. **A `throttles` table for limits that aren't per namespace** (migration 0008): `(bucket, key, window_start, count)`. `rate_limits` keys on `namespace_id` (a foreign key), so it can't hold IP buckets or a global counter. Each limit is a single atomic `insert … on conflict do update set count = count + 1 returning count`.
   - **Session creation per IP:** 5 per hour and 20 per day. The key is `HMAC(ENGRAM_IP_HASH_SECRET, day ‖ ip)`, so it rotates daily and no IP is ever stored, raw or as a stable hash. The IP comes from `x-real-ip` / the first `x-forwarded-for` entry, as Vercel sets them.
   - **Chat turns per namespace:** 30 an hour, in the existing `rate_limits` table (ledger row 5).
   - **The global daily cap:** `ENGRAM_DEMO_DAILY_TURNS`, default **120** turns per UTC day. A demo turn costs about 3 Gemini generate calls (compose, extraction, sometimes adjudication) and about 4 embed requests. 120 turns is about 360 calls, which fits one key's 500 a day and leaves room for the nightly job.
   - When the cap is hit, the stream sends `limit` with "The demo has used today's free model quota. Try again tomorrow; the showcase is still available." Reads keep working.
   - `jobs:maintain` deletes throttle rows older than 2 days.
5. **Who can read what:**

   | endpoint | bearer | demo cookie | none |
   |---|---|---|---|
   | `POST /api/remember`, `POST /api/recall` | token's namespace | — | 401 |
   | `GET /api/memories`, `GET /api/entities/:id/timeline` | token's namespace | cookie namespace | the showcase namespace (`ENGRAM_SHOWCASE_NAMESPACE`), read-only |
   | `POST /api/demo/session`, `POST /api/chat` | — | cookie namespace only | session: creates; chat: 401 |
   | `GET /api/evals` | public | public | public |
   | `/api/mcp` | token's namespace | — | 401 |

   An entity in another namespace is a 404, not a 403, so ids can't be probed. `/api/evals` becomes **public**: bench reports contain no personal data and are committed to the repo anyway (SPEC §11 patch). The showcase namespace is seeded in P10. Here it's any slug from the environment, and tests create one.
6. **Route logic lives in plain, testable modules.** `apps/web/src/server/` exports `createRoutes(deps)`, with deps `{db, provider, defer, clock, env}`. The `app/api/**/route.ts` files are a few lines each: they wire the real deps (`defer = after`) and re-export handlers. Tests call handlers with `Request` objects, a FakeProvider, a synchronous `defer`, and the local Docker database. They never start Next or touch the network.
7. **Chat turn, in order:**
   1. check the cookie, the per-namespace limit and the global cap;
   2. ingest the user turn;
   3. recall (`trackAccess: false`), then send the `memories` event;
   4. compose, then send the `answer` event;
   5. ingest the assistant turn;
   6. track access for `usedMemoryIds` only (ledger row 21; this exports core's `trackUse`);
   7. `defer(() => process both episodes)`.

   Sessions are client-chosen ids (`sessionId` in the body, validated). Session names are UI state for P09b, not stored.
8. **Database client for Vercel:** `createDb(HOSTED_DATABASE_URL, {max: 1, prepare: false, idleTimeout: 20})`, on the **direct** endpoint (ledger row 35). `prepare: false` costs nothing on the direct endpoint and keeps a switch to the pooler safe; a test pins this config (ledger row 6). If the pooler is ever adopted, every transaction must also `set local search_path`; that gets its own test then. Locally the app uses `DATABASE_URL`.
9. **MCP on Vercel:** `/api/mcp` mounts `createEngramHttpHandler` unchanged, with `background: (p) => after(p)`. In local mode, `engram_remember` processes in the background (`wait: false`); on serverless the function would otherwise freeze before that work finishes.
10. **A preview deploy in this phase** (Vercel Hobby, free), to check the one thing tests can't: a deployed function on Neon's direct endpoint resolves unqualified names. `GET /api/health` runs an unqualified query and reports the schema it resolved; the check is that it returns `engram`. P10 owns the production deploy and the showcase.

## Build notes (recorded as they happen)
- **Webpack, not Turbopack (task 1).** The engine packages use NodeNext imports (`./db/client.js` for `client.ts`) and ship TypeScript source. Turbopack, Next 16's default bundler, can't map `.js` to `.ts` ("Module not found: Can't resolve './config/clock.js'"). Webpack can, with `resolve.extensionAlias`, so `dev` and `build` pass `--webpack`. Rejected: rewriting the engine's imports (it would break NodeNext for tsx, vitest and the MCP stdio server), and compiling the packages to `dist/` (a build step for every package, only for the web app). Turbopack can be revisited if it gains extension aliasing.

- **Chat order changed (task 8).** Decision 7 stored the user's turn before recalling. Done that way, recall finds the question's own episode at similarity 1.0, which also defeats the abstention floor. Chat now recalls first, then stores the turn (before composing, so the message survives a failed reply), composes, and stores the reply.
- **Limits answer 429, not a stream event (task 8).** A refused turn returns 429 JSON (`limit: "namespace" | "global"`) before any model call or stream starts; only accepted turns stream. A plain status is simpler for clients and correct HTTP. The `error` event remains for failures mid-turn.

- **The preview deploy (task 10), as it happened.**
  - **Project:** a new Vercel project `engram` with Root Directory `apps/web`, build `pnpm build` (webpack), install `pnpm install --frozen-lockfile` and Node 22.x.
  - **Migrations:** `db:migrate:hosted` applied **0007 and 0008** to Neon. 0007 (P08b's embedding space) had never been applied there, which the P10 deploy checklist must cover.
  - **Environment:** eight Preview-only variables, the secrets marked sensitive and piped from `.env` so they were never printed. One Gemini key (the newest fallback), so demo traffic doesn't compete with the bench's main key. `ENGRAM_MCP_TOKENS` maps a generated token to a `personal` namespace; `ENGRAM_IP_HASH_SECRET` was generated too.
  - **Uploads:** `.vercelignore` keeps `.env*`, `bench/cache`, `bench/runs` and the 277 MB LongMemEval data out.
  - **Results:** `/api/health` returned `{"ok":true,"schema":"engram"}`. `/api/evals` listed the reports, so tracing works. With no credentials, `/api/memories` and `/api/mcp` answered 401.
  - **What went wrong:**
    1. The first `vercel deploy` of a new project went to **Production** (`engram-lime.vercel.app`), not a preview. It has no variables, so it fails closed (500 on `/api/health`) and can reach nothing; it should be removed or replaced in P10 (ledger row 45).
    2. A CLI deploy uploads the working tree, not git: the preview included an uncommitted, in-progress LongMemEval report. P10's production deploy goes through Vercel's Git integration.
    3. A live chat turn wasn't exercised: Gemini's embedding quota was exhausted on every key that day. Chat is covered by `chat.int.test.ts`, and the first live turn belongs to P10's smoke test.
  - Preview URLs sit behind Vercel's deployment protection, reached with `vercel curl`. POST requests couldn't be sent that way (extra curl flags drop the bypass), so demo sessions were checked by tests only.

## Scope
**In:** `apps/web` with route handlers only; migration 0008 (`throttles`); demo sessions, chat, reads, evals, MCP, health; the auth, limit and scoping tests; one preview deploy plus the health check; SPEC §11/§14 patches; `.env.example`.

**Out:** pages, styling, Tailwind and shadcn (P09b); the showcase seed and production deploy (P10); token-level streaming; the `/graph` stretch goal.

## Deliverables
```
apps/web/package.json, next.config.ts, tsconfig.json
apps/web/app/api/{remember,recall,memories,evals,mcp,health,chat}/route.ts
apps/web/app/api/entities/[id]/timeline/route.ts
apps/web/app/api/demo/session/route.ts
apps/web/src/server/{routes,auth,demo,limits,chat,reads,sse,db,env}.ts   + *.test.ts / *.int.test.ts
sql/migrations/0008_throttles.sql
packages/core: export trackUse; DbOptions.idleTimeout
scripts/maintain.ts: delete throttle rows older than 2 days
```

## Dependencies to approve
- `next` (16.x, latest stable at install), `react`, `react-dom` (19.x), and `@types/react` / `@types/react-dom` for dev. All MIT, all free.
- Nothing else. Streaming uses the web `ReadableStream`, and cookies, HMAC and SSE use `node:crypto` and plain headers. No AI SDK and no rate-limit library.

## Tasks
1. **Scaffold** `apps/web` (Next 16, App Router, TS strict, the repo's eslint and prettier), plus `createRoutes(deps)` and `GET /api/health`. Typecheck, lint and `next build` pass in CI.
2. **Database config and the lock guard:** `DbOptions.idleTimeout`, the web client config with its test, and a source scan that fails on any session-level advisory lock.
3. **Auth:** bearer → namespace through `parseTokens`; cookie → demo namespace; showcase fallback for reads. Remove `ENGRAM_API_TOKEN` from `.env.example` and SPEC §14.
4. **Migration 0008 and limits:** `throttles`; the IP-hash, per-namespace and global-cap helpers; the cleanup in `jobs:maintain`.
5. **Demo session:** `POST /api/demo/session`, with the cookie, slug derivation and IP throttle.
6. **Reads:** `/api/memories` (filters tier, status, predicate and `q`; sort by retention score), `/api/entities/:id/timeline` (`includeRevised`), and `/api/evals`, which lists `bench/reports/*.json` through `BenchSummary`.
7. **Writes:** `/api/remember` and `/api/recall` (bearer). Remember processes after the response by default, with an opt-in `wait`.
8. **Chat:** the turn flow from decision 7, SSE events, both limits, deferred processing, and access tracked for used memories only.
9. **MCP route:** mount `createEngramHttpHandler` with `after()` for background work.
10. **Preview deploy:** link the Vercel project and set its env vars (with you), deploy, and record the `/api/health` result in `docs/mcp.md` / P10 notes.

## Tests
- **`auth.test.ts`:**
  - a missing, malformed or unknown bearer gets 401;
  - a valid token resolves to its namespace;
  - a cookie never grants bearer endpoints, and a bearer never grants the cookie-only chat.
- **`limits.int.test.ts`:**
  - the 6th session creation from one IP within an hour gets 429, and a different IP is unaffected;
  - no stored row contains the raw IP or a hash that is stable across days (the source scan plus a row check);
  - concurrent increments don't lose counts (20 parallel calls → count 20).
- **`demo.int.test.ts`:** session creation makes a `demo` namespace expiring in 24 h, with an `httpOnly` / `Secure` / `SameSite=Lax` cookie, and the slug isn't the cookie value.
- **`chat.int.test.ts`** (FakeProvider):
  - events arrive in order (`memories`, `answer`, `done`);
  - the 31st turn in an hour sends `limit`;
  - at the global cap, chat sends the cap message and showcase reads still return 200;
  - processing is deferred: episodes stay unprocessed until `defer` runs, then they're processed;
  - only `usedMemoryIds` get their access recorded;
  - another namespace's session can't be written.
- **`reads.int.test.ts`:**
  - memories filter and sort correctly;
  - the timeline follows `includeRevised`;
  - another namespace's entity is a 404;
  - with no credentials, reads come from the showcase, and writes to the showcase are refused;
  - `/api/evals` returns valid summaries.
- **`mcp.int.test.ts`:** an MCP `initialize` plus `tools/list` over the route with a bearer works, and without one it gets 401.
- **`db.test.ts`:** the production client config has `max: 1` and `prepare: false`.
- **`locks.test.ts`:** a source scan finds no `pg_advisory_lock(` / `pg_try_advisory_lock(` (session level) anywhere.

## Definition of done
- [x] `apps/web` (Next.js App Router) has route handlers for `/api/remember`, `/api/recall`, `/api/memories`, `/api/entities/:id/timeline`, `/api/evals`, `/api/mcp` and `/api/health`, scoped as in decision 5, and `/api/mcp` is stateless streamable HTTP.
- [x] `POST /api/demo/session` creates a 24 h demo namespace behind an httpOnly cookie, throttled per IP through a daily-rotating HMAC (no IP stored).
- [x] `POST /api/chat` streams events, works only on the cookie namespace, allows 30 turns an hour per namespace via `rate_limits` (ledger row 5), and respects the global daily cap; the cap message leaves the showcase usable.
- [x] Chat runs `process()` after the response is sent, and tracks access only for `usedMemoryIds` (ledger row 21).
- [x] A test proves the production client config has `prepare: false` and `max: 1` (ledger row 6); no session-level advisory lock exists (source scan).
- [x] `/api/mcp` mounts P07's `createEngramHttpHandler` unchanged.
- [x] Vercel connects to Neon's direct endpoint, and a deployed preview's `/api/health` resolves unqualified names to `engram` (ledger row 35). _2026-10-19: `{"ok":true,"schema":"engram"}` from the preview, about 3 s cold._
- [x] REST and MCP share `ENGRAM_MCP_TOKENS`; `ENGRAM_API_TOKEN` is gone from `.env.example` and SPEC §14 (ledger row 33).
- [x] The route tests above pass on the local DB with the FakeProvider; CI builds the app.
- [x] SPEC §11 (public evals, `throttles`, event streaming) and §14 are patched; ADR-019 records decisions 1–4 (and the build notes).

## Planned commits
1. `docs(phases): plan the web api`
2. `feat(web): scaffold the next.js app and health route`
3. `feat(core): pool options for serverless clients`
4. `feat(db): add throttles for ip and global limits`
5. `feat(web): demo sessions with per-ip throttling`
6. `feat(web): read endpoints scoped by token, cookie or showcase`
7. `feat(web): remember and recall over rest`
8. `feat(web): stream chat turns with limits and deferred processing`
9. `feat(web): serve mcp over streamable http`
10. `docs(decisions): record the web api's auth and limits` (ADR-019)

## Free-tier notes
| resource | use in this phase |
|---|---|
| Gemini | **0 calls**: every test uses the FakeProvider. The preview deploy's health route makes no model call. |
| Neon | the preview deploy's health check and a few manual requests; never tests or bench (CLAUDE.md) |
| Vercel Hobby | one project, preview deploys only |
| Groq | none |

## What you'll need to do
- Approve the dependencies above.
- For task 10, have a free Vercel account and run `vercel login` once, or connect the GitHub repo in Vercel's dashboard. You'll also approve the preview's env vars before I set them (`HOSTED_DATABASE_URL`, one Gemini key, `ENGRAM_MCP_TOKENS`, `ENGRAM_IP_HASH_SECRET`, `ENGRAM_SHOWCASE_NAMESPACE`).

## Risks and verify-at-build-time
- **Verify:** the stable Next.js 16 version and `after()`'s behavior in route handlers that return a stream. The work must start after the stream closes, not after the headers are sent. If it starts early, chat defers from the stream's final `done` instead.
- **`after()` is best-effort.** If a deploy or crash kills a function mid-processing, the episode stays unprocessed. P07's `processPending` and the nightly `jobs:consolidate` already sweep unprocessed episodes, so nothing is lost, only delayed.
- **Cold starts** on Neon (a few hundred ms after 5 idle minutes) plus Vercel can make the first chat turn slow. The `memories` event shows progress quickly.
- **Rate-limit abuse beyond IP:** rotating IPs could mint sessions, but the global daily cap still bounds the quota spent. That bound is the real protection; the IP throttle only raises the cost.
- **Cookies on preview URLs:** `Secure` needs HTTPS, which previews have; local dev uses `http://localhost`, so `Secure` is off when `NODE_ENV !== 'production'`.
- **The monorepo on Vercel:** the root directory is `apps/web`, and workspace packages are built by `next build` through `transpilePackages`. Verify this in task 1, not in task 10.
