# P07 — MCP server

**Status:** done (2026-10-17)

## Goal
Expose Engram to any MCP client: six tools and a stats resource built on the official TypeScript SDK. One server factory backs two transports: a stdio binary for local clients (Claude Code, Claude Desktop, Cursor), and a stateless, bearer-authenticated HTTP handler that P09a mounts at `/api/mcp` without changes.

## Spec refs
§10 (tools, resource, namespace selection, transports, known limitation, DoD), §6.1 (`wait` semantics for remember), §6.2 (MCP recall tracks access), §9.3 (forget modes), §8 (manual consolidation), §11 (bearer tokens), §15 P7.

## Depends on / unlocks
- **Depends on:** P06b. Every engine capability the tools wrap exists: ingest/process, recall, history, forget, consolidate, decay bookkeeping.
- **Unlocks:** P08 (the engine is feature-complete before the test split is measured), P09a (`/api/mcp` mounts the HTTP handler from here).

## SDK (verified 2026-10-17)
- **v2 is the stable line.** `@modelcontextprotocol/server` and `@modelcontextprotocol/client` are at 2.3.1. 2.0.0 shipped on 2026-07-27, and v2 implements the 2026-07-28 MCP spec. The v1 monolith `@modelcontextprotocol/sdk` (1.32.1) is superseded.
- **One factory, both transports.**
  - `createMcpHandler(factory)` returns a web-standard `fetch` handler that is stateless per request. That's the shape a Next.js route handler on Vercel needs.
  - `serveStdio(factory)` serves stdio.
  - The factory receives `ctx.authInfo`, which is how a bearer token becomes a namespace.
- **Older clients still work.** The server negotiates down to the 2025-era protocol revisions (`2025-06-18`, `2025-03-26`, `2024-11-05`), so clients that haven't moved to the 2026 spec still connect.
- **Tools:** `registerTool(name, { title, description, inputSchema: z.object(…), outputSchema, annotations }, handler)`, returning `{ content, structuredContent }`. Our zod 4.6 satisfies the server's `zod ^4.2.0`.

## Scope
**In:**
- `packages/mcp`: the server factory, six tools, the stats resource, the stdio entry, the HTTP handler with bearer → namespace mapping, and tests;
- the small core additions the tools need;
- a JSON summary next to each bench report, for the "latest bench score";
- `docs/mcp.md`: client configs, a recorded Inspector session, and the Claude Code check.

**Out:**
- the Next.js route itself (P09a);
- OAuth (§1 non-goal: bearer only);
- publishing the package to npm;
- any attempt to make agents call `remember` more often (§10 known limitation: document it, don't engineer around it).

## Design decisions
1. **`createEngramServer({ db, provider, namespaceId, clock })`** returns an `McpServer`.
   - Every tool is scoped to that one namespace.
   - It's a pure factory: no globals, no process state. Both transports and the tests use it.
2. **Namespaces.**
   - **stdio:** `ENGRAM_NAMESPACE` is a slug, created as a `user` namespace if it's missing.
   - **HTTP:** `ENGRAM_MCP_TOKENS` maps tokens to slugs as `token:slug` pairs, comma-separated.
   - **Token checks:** compared in constant time; a missing or unknown token gets 401 before any server is built. Tokens never appear in logs or tool output.
3. **Isolation is enforced in core, not just in the tool layer.**
   - `history()` gains a `namespaceId` filter.
   - Entity references resolve only inside the namespace.
   - `forget` is already scoped.
   - A test proves that token B can't read, forget or see the history of anything in namespace A, even with A's ids.
4. **Tools** (zod inputs; deterministic text plus `structuredContent` matching an `outputSchema`). Every description says *when* to call the tool.

   | tool | input | does | annotations |
   |---|---|---|---|
   | `engram_remember` | `content`, `session_id?`, `occurred_at?`, `wait? = true` | `ingest`, then `processEpisode` (awaited unless `wait: false`) | — |
   | `engram_recall` | `query`, `k? = 8`, `valid_at?`, `known_at?`, `include_archived?` | `recall` with `trackAccess: true` (§6.2: MCP tracks everything returned) | read-only |
   | `engram_history` | `entity`, `predicate?`, `include_revised?` | the scoped `history()` timeline | read-only |
   | `engram_entities` | `query`, `limit? = 10` | `searchEntities` (new): name and alias match plus embedding similarity | read-only |
   | `engram_forget` | `fact_id?` or `entity` with `predicate?`, `mode`, `confirm_hard?`, `reason?` | `forget`; a hard purge refuses without `confirm_hard: true` | destructive |
   | `engram_consolidate` | none | `consolidate({ namespaceId })` | — |

   - **Remember's output:** the episode id, its status (processed, skipped or pending), importance, the extracted count, created entities, and every resolution outcome (inserted, merged, updated, backfilled, corrected, coexisted, rejected). This is the P02 summary contract.
   - **Session default:** `session_id` defaults to `mcp-YYYY-MM-DD` (UTC). Remembers from one day then form a session that consolidation can cluster.
   - **Role:** content is stored with role `user`, because it's what the agent learned about the user.
   - **`wait: false`:** returns at once with status `pending`. Processing continues in the background, and a failure is logged to stderr, never stdout.
   - **Nothing stays unprocessed.** A new core `processPending({ namespaceId, limit })` finishes episodes whose `processed_at` is still null, for example when a client exited mid-processing. It runs when the stdio server starts (in the background) and at the start of `engram_consolidate`, since consolidation only clusters processed turns.
   - **Entity references** (`entity` in history and forget) accept an id, a name or alias (case-insensitive), or `user`/`me`/`self` for the self entity. An ambiguous name returns an error listing the candidates with their ids, rather than guessing.
   - **Errors:** expected errors (`ForgetError`, an unknown entity, an ambiguous name) come back as `isError: true` with a one-line message. Anything else propagates.
5. **Resource `engram://stats`** (JSON plus a text rendering):
   - current beliefs by tier and by status, plus episode, summary and entity counts;
   - the ad-hoc predicate rate;
   - the last decay sweep (`lastSweep`);
   - the latest bench score. Bench reports now write `<run>.json` beside `<run>.md`, and stats reads the newest one, with `n/a` if none exists, as on Vercel. Existing runs are backfilled with `--report-only` at 0 calls.
6. **Output text is deterministic**: fixed ordering, ISO dates, no timing data. Tests snapshot it.
7. **stdio entry** (`packages/mcp/src/stdio.ts`):
   - it loads the repo `.env` and builds `GeminiProvider` with key failover, then `serveStdio`;
   - nothing writes to stdout except the protocol, and a test checks it;
   - clients launch it through the package's own `tsx` (`packages/mcp/node_modules/.bin/tsx`), not `pnpm run`, whose banner would corrupt the stream.
8. **HTTP handler** (`packages/mcp/src/http.ts`): `createEngramHttpHandler({ db, provider, tokens })` returns a `{ fetch }` built on `createMcpHandler`. P07 tests it in-process, with the SDK client's streamable-HTTP transport and `fetch` pointed at the handler, so there's no port and no network. P09a only mounts it.

## Deliverables
```
packages/mcp/package.json, tsconfig.json, vitest.config.ts
packages/mcp/src/{server,tools,format,refs,stats,http,stdio,env}.ts (+ tests)
packages/core/src/resolve/search.ts           # searchEntities
packages/core/src/stats/stats.ts              # namespaceStats
packages/core/src/ingest/pending.ts           # processPending
packages/core/src/temporal/history.ts         # + namespaceId scoping
bench/runner/report.ts                        # + <run>.json summary
docs/mcp.md                                   # client configs, Inspector session, Claude Code check
DECISIONS.md                                  # ADR-013: MCP SDK v2, one factory for both transports
```

## Dependencies to approve
- `@modelcontextprotocol/server@2.3.1`, a dependency of `packages/mcp`: the official SDK (§10).
- `@modelcontextprotocol/client@2.3.1`, a dev dependency of `packages/mcp`, used only by the tests. They drive the server through the real client, as §10's DoD asks.
- `tsx` in `packages/mcp`: already in the workspace, so not a new package. It runs the stdio entry.
- The MCP Inspector runs through `npx @modelcontextprotocol/inspector` for the walkthrough and is not added to the repo.

## Tasks
1. **Core:** `searchEntities`, `namespaceStats`, `processPending`, namespace-scoped `history`, tested over the local DB with FakeProvider.
2. **Server:** the `packages/mcp` scaffold, the factory, six tools, the stats resource and the formatting. Tested through the SDK client over the in-memory transport: tool list and descriptions, each tool's text and structured output, the hard-purge refusal, `wait: false`, errors.
3. **Transports:**
   - the HTTP handler with bearer mapping, with the auth and isolation tests;
   - the stdio entry, with a spawn test that runs `initialize`, `tools/list` and the stats resource with no provider calls and a clean stdout.
4. **Bench:** a JSON summary beside each report, backfilled for existing runs (0 calls).
5. **Live checks:**
   - an MCP Inspector CLI session against the stdio binary, recorded in `docs/mcp.md`;
   - Claude Code calling `engram_remember` then `engram_recall`;
   - copy-paste configs for Claude Code, Claude Desktop and Cursor.
6. **Close:** update the spec (§4, §10, §11), add ADR-013, update the ledger, tick the DoD.

## Tests
- **Contract:** `tools/list` returns exactly the six tools. Every description says when to call the tool. Input schemas reject bad values (an empty `content`, a `k` out of range, a malformed date).
- **remember:**
  - with `wait: true`, a scripted extraction is stored and the summary counts match the revisions written;
  - with `wait: false`, it returns `pending` and the episode is processed afterwards;
  - tool output is skipped (status `skipped_tool`).
- **recall:**
  - structured memories carry provenance plus valid and record windows;
  - `valid_at`/`known_at` change the answer (the P03 Paris → Berlin scenario);
  - access tracking increments `access_score`.
- **history:** by name, by `self` and by id; `include_revised` adds replaced versions; an unknown entity and an ambiguous name are errors.
- **entities:** finds by alias and by similarity, in deterministic order.
- **forget:** archive and retract work; a hard purge without `confirm_hard` returns an error and changes nothing; with it, the purge report comes back.
- **consolidate:** a scripted summarize promotes facts, and the tool reports the counts. An episode left unprocessed by `wait: false` is processed first.
- **processPending:** it processes only unprocessed episodes in the namespace, oldest first, up to the limit, and is a no-op when re-run.
- **stats:** the counts match the store, the last sweep appears after `decaySweep`, the bench score comes from a fixture report directory, and it's `n/a` with none.
- **HTTP:**
  - a missing or wrong bearer gets 401;
  - tokens A and B see only their own namespaces;
  - A's fact id given to B's `engram_forget` and `engram_history` reports nothing found.
- **stdio:** spawning the binary, the client lists the tools and reads stats. Every stdout line is valid JSON-RPC.

## Definition of done
- [x] `packages/mcp` with `engram_remember`, `engram_recall`, `engram_history`, `engram_entities`, `engram_forget`, `engram_consolidate` and `engram://stats`. Inputs use zod schemas. Outputs are concise deterministic text plus structured content. Descriptions say *when* to call each tool.
- [x] stdio entry using `ENGRAM_NAMESPACE`. The transport-agnostic server factory is ready for HTTP mounting with bearer → namespace mapping, and the HTTP handler is tested in-process.
- [x] An integration test drives the server through the SDK client (in-memory and stdio transports) over the local DB with FakeProvider.
- [x] Namespace isolation is tested across bearer tokens, including cross-namespace ids.
- [x] Claude Code calls `engram_remember` and `engram_recall` locally (a manual check, written down in `docs/mcp.md`).
- [x] An MCP Inspector session is recorded. Copy-paste configs for Claude Code, Claude Desktop and Cursor are drafted for the README.
- [x] `engram_forget` with `mode: 'hard'` refuses without `confirm_hard: true`.
- [x] Bench reports write a JSON summary, and `engram://stats` shows the latest score.
- [x] Every ledger row targeting P07 is closed (see [README](README.md#carried-items-ledger)).

## Planned commits
1. `docs(phases): expand P07 and add the carried-items ledger`
2. `feat(core): add entity search, stats, pending catch-up and scoped history`
3. `feat(mcp): expose engram as six mcp tools and a stats resource`
4. `feat(mcp): serve over stdio and bearer-authenticated http`
5. `feat(bench): write a json summary beside each report`
6. `docs(mcp): record an inspector session and client configs`
7. `docs: close P07 and record the mcp design`

## Testing budget (two free keys)
| Test | Gemini generate calls | When |
|---|---|---|
| Unit and integration tests (FakeProvider, in-memory, HTTP and stdio transports) | 0 | always |
| Bench JSON backfill (`--report-only`) | 0 | once |
| Inspector session: remember, recall, entities, history, consolidate, forget | ~3 (1 extraction, 1 summarize, ≤1 adjudication) plus a few embeddings | once |
| Claude Code check: remember, then recall | ~1–2 plus embeddings | once |
| **Total** | **≤ 10** | today on the fallback key (~400 left), or tomorrow after the main key resets at 12:30 IST |

## Risks and verify-at-build-time
- **Client support for 2026-spec features.** Clients may be on the 2025 protocol. Use only tools, structured content and resources, which both eras support, and check that Claude Code connects during the manual check.
- **stdout pollution** breaks stdio silently. The spawn test checks every stdout line, and all logging goes to stderr.
- **Background processing with `wait: false`** in a short-lived stdio process can be cut off when the client exits. The episode stays stored, and `processPending` finishes it on the next server start or consolidation.
- **Verify:** that the Inspector CLI mode (`--cli`) still exists in Inspector 2.11. If not, record the session with the SDK client script instead and say so.
- **The stats "latest bench score"** depends on the report JSON shape. It's versioned with a `schema: 1` field.
- **Known limitation** (§10): recall depends on agents actually calling remember. Document it, and don't engineer around it.

## Summary

Done 2026-10-17, using 3 Gemini generate calls (budget: ≤ 10), plus embeddings.
- **`packages/mcp`** serves six tools and `engram://stats` from one factory on MCP SDK v2 (ADR-013).
- **Transports:** a stdio binary and a stateless bearer-token HTTP handler that P09a mounts unchanged.
- **Tests:** 21 run with FakeProvider, driving the real client over three transports: in-memory, in-process HTTP (including 2025-protocol clients and cross-namespace ids), and the spawned stdio binary (with a stdout-is-only-JSON-RPC check).
- **Live:**
  - an MCP Inspector CLI session against real Gemini;
  - a two-session Claude Code check, in which the second process recalled what the first remembered.

  Both are in `docs/mcp.md`, with configs for Claude Code, Claude Desktop and Cursor.
- **Core additions:** `searchEntities`, `namespaceStats`, `processPending`, and a namespace-scoped `history()`. Bench reports now write a JSON summary, backfilled for every past run at 0 calls.

Found and fixed along the way:
- **The decay sweep failed on underflow.** Postgres raises on an underflowing double, and `access_score` is a `real` column. A far-future sweep in the stats test exposed it, and migration 0006 clamps it. Without the fix, one long-idle fact would eventually break every hosted sweep.
- **The entity-search floor was too low** for real embeddings (the Inspector session listed Porto for "Ana"). It's now 0.7, from measured similarities.
- **A stale global sweep row** from P06a-era testing was in the shared dev DB. It was removed; no test sweeps globally.

Deviations from the plan above:
- **`processPending` was added.** The plan first left `wait: false` stragglers as a limitation; under the carried-items rule it was built instead. It runs on stdio start and in `engram_consolidate`.
- **Bench summaries carry `finishedAt` and `retrievalOnly`,** so stats orders runs reliably and skips ranker comparisons that composed no answers.
- **Inspector 2.11 asks for Node ≥ 22.19** (this machine has 22.14). The CLI worked regardless. Upgrading Node is noted for P10's fresh-clone check.

Carried forward (ledger rows 32 and 33):
- **Recall ranking** for questions about the user goes to P08, with tuning on dev.
- **The REST bearer scheme** (`ENGRAM_MCP_TOKENS` vs `ENGRAM_API_TOKEN`) goes to P09a.

