# Decisions

Short ADRs, append-only. When a decision changes, add a new entry that supersedes the old one and mark the old one `Superseded by ADR-NNN`; don't edit or delete history.

---

## ADR-001 — TypeScript monorepo with a hand-built engine

**Date:** 2026-10-16 · **Status:** Accepted

**Context.** The project exists to show memory internals: conflict resolution, bitemporal validity, decay, consolidation. Graphiti, Mem0 and similar engines would hide exactly those parts, and Graphiti adds a Python service plus a graph database.

**Decision.** A single-language pnpm workspace (TS strict), with the engine hand-built on Postgres + pgvector (SPEC §2). Graphiti stays a documented alternative (SPEC Appendix B). TypeScript is pinned to 6.0 because typescript-eslint doesn't support the 7.x native compiler yet.

**Consequences.** Engine, MCP server, web app and bench share types. We own the correctness of the temporal model, which is why its tests come first (SPEC §16).

---

## ADR-002 — Docker pgvector for dev and CI, Supabase for hosting

**Date:** 2026-10-16 · **Status:** Accepted

**Context.** Everything must run on free tiers. The local Supabase stack needs several GB of images on a disk with little free space, and tests should run offline. pg_cron, the only Supabase-specific feature, is needed only for scheduling on the hosted database.

**Decision.** Local dev and CI use the plain `pgvector/pgvector:0.8.7-pg17` image (pg17 matches new Supabase projects). SQL is split in two: `supabase/migrations/` is portable and applied everywhere, and `supabase/hosted/` (pg_cron schedules, role revokes) is applied only by `pnpm db:migrate:hosted`. The runner refuses to apply hosted SQL to a local URL or to reset a remote one. Migrations run one file per transaction under `pg_advisory_xact_lock`, with checksums so an applied file can't be edited.

**Consequences.** Decay and cleanup are SQL functions tested locally with a simulated clock; only their schedules are hosted-only and verified at deploy (P10). A homegrown runner replaces the Supabase CLI, roughly 100 lines with its own tests.

---

## ADR-003 — An unexposed `engram` schema

**Date:** 2026-10-16 · **Status:** Accepted

**Context.** Supabase serves the `public` schema over its REST API, and the anon key is public by design. Tables in `public` without row-level security would let anyone with the project URL read every stored memory.

**Decision.** All Engram objects live in an `engram` schema, which isn't in the API's exposed schemas; extensions live in `extensions` on every target. `supabase/hosted/0001_revoke_api_roles.sql` revokes schema usage and object privileges from `anon` and `authenticated` (and function execute from `PUBLIC`). Clients always set `search_path = engram, extensions, public` per connection.

**Consequences.** The app connects only through `DATABASE_URL`, so this costs nothing in code. Any future hosted migration that creates objects should be followed by a check that anon REST calls still fail (P10 verification).

---

## ADR-004 — Gemini over REST, embeddings from gemini-embedding-2 at 768 dims

**Date:** 2026-10-16 · **Status:** Accepted

**Context.** Engram needs embeddings and JSON generation on a free tier. As of October 2026, Google's docs list `gemini-embedding-2` (stable, free tier, 3072 native dims, normalizes truncated outputs itself, task prefixes instead of a `taskType` field) and the older text-only `gemini-embedding-001`.

**Decision.** Call the REST API with `fetch` rather than the SDK: the surface we use is two endpoints, and owning the HTTP layer gives us testable backoff (429/5xx with jitter, Retry-After) and no extra dependency. Embed with `gemini-embedding-2` at `outputDimensionality: 768` using the documented prefixes (`title: none | text: …` for documents, `task: search result | query: …` for queries), and L2-normalize anyway as a cheap safeguard. Structured calls use `generateContent` with `responseMimeType: application/json`, zod validation and one repair round. The chat model is chosen in P02.

**Consequences.** Vectors are stored as pgvector float32, so they round-trip by direction, not bit-for-bit. Switching to `gemini-embedding-001` would need `taskType` instead of prefixes and a re-embed of everything (an ADR). `pnpm gemini:check` verifies a real key in 2–3 requests.

---

## ADR-005 — Chat model gemini-3.5-flash-lite, with flat "wire" schemas

**Date:** 2026-10-16 · **Status:** Accepted

**Context.** An A/B on four tricky turns: `gemini-3.5-flash` and `gemini-3.8-flash` returned 503 ("high demand") and 429 within a few calls. The free tier allows 5 requests per minute per model for 3.8-flash. `gemini-3.5-flash-lite` answered every call, and after two prompt fixes its extractions were correct on corrections, relative dates, closed windows and the two-Sams case. Gemini accepts a JSON Schema (`responseJsonSchema`) but doesn't enforce `const`/`anyOf` branches: it returned `"kind": "forever"` for a discriminated union.

**Decision.** Use `gemini-3.5-flash-lite` for extraction and disambiguation. The model fills flat wire schemas (enums and nullable fields, which it follows reliably); code maps them onto the contract types and validates once, reporting issues through the zod context so a bad reply still gets its repair round. Backoff honours `google.rpc.RetryInfo` from the error body. A prompt version hash travels with recorded fixtures.

**Consequences.** Throughput is bounded by flash-lite's free per-minute and per-day quotas; P04 budgets bench runs from them. If a larger model becomes usable on the free tier, compare it on the dev split before switching (ADR).

---

## ADR-006 — Temporal hints, window rules, and no LLM calls under the lock

**Date:** 2026-10-16 · **Status:** Accepted

**Context.** Models are unreliable at date arithmetic, and transactions held open across network calls hurt the pooler and serialize writers for seconds.

**Decision.** Extraction returns temporal hints (absolute, relative, named period, none) that `resolveHint` resolves against `occurred_at` in pure, tested code. A window's end resolves to the start of its period, so adjacent statements meet instead of overlapping. The same period at both ends spans it. End-only facts with no start are dropped. Entity resolution plans and disambiguates outside any transaction, then re-checks under `pg_advisory_xact_lock` and restarts if the candidates changed.

**Consequences.** "From 2015 through 2018" loses 2018 at year precision; acceptable. Dropped end-only facts ("before that, Marseille") stay recoverable from episodes; supporting an unknown `valid_from` is a P03 design question. Conflict resolution (P03) should reuse the optimistic pattern.

---

## ADR-007 — Unknown starts as -infinity

**Date:** 2026-10-16 · **Status:** Accepted (supersedes the "drop end-only facts" part of ADR-006)

**Context.** "Before that, I lived in Marseille" ends at a known time with no stated start. Dropping it loses exactly the out-of-order history backfill exists for; defaulting its start to the turn invents a current fact.

**Decision.** Store `valid_from = '-infinity'` with `valid_from_source = 'unknown'` (migration 0003, with a CHECK keeping the two in step). postgres.js's date type is overridden to map `-infinity` to and from the earliest JS `Date` (`UNKNOWN_START`); strings bound to timestamp columns pass through unchanged.

**Consequences.** The canonical query and the rule fast-path need no special cases: an unknown start precedes every instant, and backfill places it before the earliest known row. Displays must render `UNKNOWN_START` as "unknown".

---

## ADR-008 — Resolution order, merge semantics and locking

**Date:** 2026-10-16 · **Status:** Accepted

**Context.** SPEC §7.2 listed update before the correction cue. Then "Actually I work at Acme, not Initech", said after Initech, matches the update rule and closes Initech instead of retracting it. Merges change provenance and confidence, which §5.1 doesn't allow in place. The optimistic lock pattern starved when ten writers restated one fact at once.

**Decision.**

- **Order:** for single-valued predicates the order is merge, correction cue, noise, static handling, backfill, update, adjudicate.
- **Merges** write a new version whenever they change provenance, confidence (noisy-OR, capped at 0.99, only for new episodes) or bounds. Objects compare by entity, then by label, then by literal paraphrase.
- **Corrections** without stated bounds inherit the retracted fact's window.
- **Locking:** rule decisions apply under the lock; only adjudication (and entity disambiguation) leaves it, guarded by a fingerprint of the beliefs.
- **Ad-hoc predicates** are multi-valued and dynamic.

**Consequences.** Frequent restatements create version chains, which is the audit trail working as intended, and decay/consolidation must treat versions as one fact. A plain insert into an empty history writes no revision row; every other outcome writes exactly one.

---

## ADR-009 — Engram-Bench: code-derived truth, three model families, an HTTP cache

**Date:** 2026-10-16 · **Status:** Accepted

**Context.** The bench must not grade Engram on its own assumptions (SPEC §13.2), must fit free quotas, and must run in CI with no keys or network.

**Decision.**

- **Ground truth is code.** Seeded persona timelines and every expected answer, including what could be believed at a past record time, are computed in plain TypeScript. A lint rule keeps that code from importing the predicate registry.
- **Three model families.** Qwen (`qwen3.8-27b` on Groq) only verbalizes sessions, and its output is checked for required strings, forbidden topics and implicit moves. Gemini is the system under test. The judge is `gpt-oss-120b` on Groq.
- **An HTTP response cache** keyed by URL and request body sits in front of every provider. Items that share a persona replay identical turns as cache hits.
- **Smoke runs offline.** A 20-item subset replays committed responses in read-only mode in CI. To make request bodies deterministic, providers alias database ids out of prompts.

**Consequences.** A cold dev run is about 25 minutes at free pacing, and re-runs are nearly free. Dev histories are short (≤20 turns), so buffer and full_context see identical prompts; the full test split needs longer histories to separate them.

---

## ADR-010 — Recall: RRF, a 0.5 safety floor, and the dev targets

**Date:** 2026-10-17 · **Status:** Accepted

**Context.** P05 built `recall()` with two rankers and an abstention floor, to be chosen on dev (SPEC §6.2, §13.1). The 40-item dev split (14 turns per history) saturates, so a `dev-long` variant adds filler sessions (about 37 turns per history) for tuning. Retrieval-only runs and a floor-0 run let rankers and floors be compared without spending generation quota.

**Decision.**

- **Ranker: RRF.** On dev-long, RRF and min-max linear tie at recall@8 35/36. The one miss is dev-019, whose answer lives in a validity window rather than in text: a label limitation. RRF is the spec default and has no weights to tune.
- **Floor: 0.5.** Abstention items' best similarities (0.67–0.77) overlap answerable ones (lowest 0.72), so no floor separates them. Simulated accuracy is 100% for every floor from 0 to 0.7, because the composer abstains correctly. 0.5 stays as a safety net.
- **Targets (dev-long, regressions fail):** engram accuracy ≥ 95% (now 100%), recall@8 ≥ 95% (now 97%).

**Consequences.** On histories this short, rag and full_context also score 100%; only buffer degrades, to 71% on 35 of 40 items so far (cross-session 45%, multi-hop 0%). Showing engram's advantages needs far longer histories (P08), and at one extraction call per turn that would exceed free quotas, so P08 must reconsider extraction batching.

---

## ADR-011 — Decay bookkeeping and span redaction in the hard purge

**Date:** 2026-10-17 · **Status:** Accepted

**Context.** SPEC §9 left two things open: where the sweep's Δt for access decay comes from, and how to "redact the relevant content" of an episode. The no-trace purge test also showed that information survives in episodes that merely _mention_ the purged value ("Before Paris I lived in Lyon"), not just in source episodes.

**Decision.**

- **Δt:** each sweep is recorded in `engram.decay_sweeps`, and Δt is the time since the previous sweep covering the namespace.
- **Redaction:** the hard purge redacts _terms_: literals no remaining fact uses, and the names and aliases of entities left without facts. Mentions of those terms in any episode of the namespace are replaced in place with `[redacted]`. A source episode that backs no other fact is deleted. Changed episodes drop their embeddings, and summaries over them are deleted until P06b regenerates them.

**Consequences.** A full-text search for the purged value finds nothing, and the rest of each turn survives. A name still used by other facts is kept, so purging "lives in Paris" doesn't erase a friend who also lives in Paris. Episodes that lost their embeddings are reachable by full text only until re-embedded.

---

## ADR-012 — Repeatable migrations for generated hosted SQL

**Date:** 2026-10-17 · **Status:** Accepted

**Context.** The pg_cron schedules in `supabase/hosted/` are generated from `config` (P06b), so they change whenever a decay parameter or the static-predicate list does. The migration runner refuses an applied file whose content changed, which keeps numbered migrations honest but would make every regenerated schedule break `db:migrate:hosted`.

**Decision.** A file named `R__*.sql` is _repeatable_, in the Flyway sense: it's re-applied whenever its checksum changes, after the numbered files of its source, and its SQL must be idempotent. Numbered files keep the strict rule. The schedule file is `supabase/hosted/R__cron_schedules.sql`, and `cron.schedule` replaces a job of the same name, so re-applying it is safe.

**Consequences.** Changing `config.decay` or `config.schedules` means running `pnpm db:hosted-cron` and committing the result (a drift test enforces it). The next `db:migrate:hosted` then updates the hosted jobs in place.

---

## ADR-013 — MCP SDK v2, with one server factory behind both transports

**Date:** 2026-10-17 · **Status:** Accepted

**Context.** SPEC §10 asks for the official TypeScript MCP SDK, with stdio for local clients and streamable HTTP at `/api/mcp` on Vercel (P09a). The SDK now has two lines: the v1 monolith `@modelcontextprotocol/sdk` (1.32.1), and v2's split packages `@modelcontextprotocol/server` and `/client` (2.3.1; 2.0.0 shipped on 2026-07-27), which v2 calls the stable line.

**Decision.**

- **Use v2.** Its `createMcpHandler(factory)` is a stateless, web-standard `fetch` handler, which a Vercel route handler can mount directly. `serveStdio(factory)` serves the same factory over stdio. It still negotiates the 2025 protocol revisions, so older clients work.
- **One factory:** `createEngramServer({ db, provider, namespaceId })` scopes every tool to one namespace. Bearer tokens map to namespaces before the factory is called (401 otherwise), so an HTTP request can never reach another namespace's server.
- **Tests:** the client package is a dev dependency. Tests use the real client over the in-memory transport, in-process HTTP and the spawned stdio binary.

**Consequences.** P09a only mounts the handler. The only additions are one dependency and one dev dependency, both official MCP packages.

---

## ADR-014 — Neon instead of Supabase for the hosted database

**Date:** 2026-10-17 · **Status:** Accepted. Supersedes ADR-002's hosted half, and the pg_cron schedules from P06b.

**Context.** ADR-002 planned Supabase's free tier as the hosted database. The project's hosted database is now a Neon free project: Postgres 18.6, pgvector 0.8.6, 1 GB storage, 100 CU-hours and 5 GB egress a month, and scale to zero after 5 idle minutes, which can't be disabled. Probing it before migrating found three differences:

- Neon's proxy drops the `search_path` startup parameter.
- There are no `anon`/`authenticated` roles.
- pg_cron exists but only runs while the compute is awake.

**Decision.**

- **Neon hosts the demo database.** `HOSTED_DATABASE_URL` is the direct endpoint, for migrations, jobs and, by default, Vercel (`max: 1` per function). Neon's PgBouncer endpoint resets every session to its own search path, ignoring both the startup parameter and the database default, so it's used only if P09a sets the path per transaction.
- **Search path:** each migration sets it in its transaction, and `sql/hosted/0002` sets it as the database default, which direct sessions honor.
- **Revokes:** the Supabase role revokes run only where the roles exist. Neon's Data API stays off, so no REST surface exists.
- **No pg_cron.** `pnpm jobs:maintain` (decay sweep and demo cleanup) and consolidation run from `nightly.yml`, the database's single daily wake-up, which costs a few CU-minutes.
- **`supabase/` is renamed `sql/`.** Tracking names (`migrations/…`, `hosted/…`) are unchanged.

**Consequences.**

- Demo cleanup runs nightly, not hourly. That's fine for 24h namespaces on 1 GB.
- The first query after an idle spell pays Neon's wake-up latency (verify the effect on Vercel in P09a).
- Exceeding the monthly compute suspends the database until the next month, so bench runs stay on the local database, never Neon.
- Probing also exposed a latent bug unrelated to the host: untyped `db.array()` fails in a fresh connection's first query. Fixed with typed helpers and a guard test.
