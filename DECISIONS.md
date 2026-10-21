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

**Date:** 2026-10-16 · **Status:** Accepted. Its hosted half (Supabase) is superseded by ADR-014 (Neon).

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

---

## ADR-015 — Batched extraction for bulk history

**Date:** 2026-10-18 · **Status:** Accepted

**Context.** Per-turn extraction makes one generate call and one embedding call per turn. P08 needs a 200-item test split (~2,800 turns) and a ~100-item LongMemEval-S subset, which measures at 46,400 turns, 4,464 unique sessions and 11M tokens. Two free Gemini keys allow ~950 generate calls a day. Alternatives researched on 2026-10-17 (P08 plan):

- **Gemini Batch API:** not on the free tier.
- **Groq:** ~200K tokens a day on its free models.
- **Local Ollama (qwen3.5:9b on an M3 Pro):** ~31 tokens/s, output-bound, so 4+ minutes for even a small packed history.
- **Gemma 4:** a separate quota, but 29 s for a tiny prompt.
- **Shrinking LongMemEval to 50 items:** the spec's last resort.

**Decision.**

- **`processSessions`:** sessions are packed into structured calls that return candidates citing their turns, which then go through the unchanged candidate pipeline.
- **Test split:** one session per call, about 720 calls. Record time comes from the cited turn, keeping `known_at` items exact.
- **LongMemEval:** packed at 20k tokens, about 600 calls instead of 4,464, because it asks no record-time questions.
- **Parity gate:** on dev and dev-long first.
- **Unchanged:** live writes stay per turn; the local model is used for free iteration and test-split filler, never for reported numbers.

**Consequences.** The reports state the extraction mode. Packing risks missing small details. Raw turns stay embedded for episode recall, which is the main path for LongMemEval's detail questions, and the parity gate measures any loss.

---

## ADR-016 — Local mode: Ollama with the schema in the prompt, model-default sampling, a 4,096-token cap

**Date:** 2026-10-18 · **Status:** Accepted (P08b)

**Context.** Ollama 0.40.5 can't constrain qwen3.5's output on any route: `/api/chat` `format`, `/v1/chat/completions` `response_format`, and raw `/api/generate` all return 501 "structured output is unavailable" ([ollama#14645](https://github.com/ollama/ollama/issues/14645)). Two questions were measured on the 10 golden fixture conversations (30 structured calls: per-turn and per-session extraction, M3 Pro), using `bench/spikes/transport.ts`, with results in `bench/spikes/transport-*.json`:

1. Does grammar-constrained decoding (llama.cpp's server, same model, Q4_K_M) beat Ollama with the schema in the prompt (NVFP4)?
2. Is qwen3.5's default `presence_penalty 1.5` the cause of off-schema replies?

| run                                             | wall      | needed repair | failed | output tokens | Gemini golden facts recovered |
| ----------------------------------------------- | --------- | ------------- | ------ | ------------- | ----------------------------- |
| Ollama, schema in prompt (penalty 1.5, default) | **550 s** | 5             | 1      | 18,853        | 28/33                         |
| llama.cpp, json_schema grammar                  | 804 s     | **1**         | **0**  | 17,278        | 27/33                         |
| Ollama, penalty 0.5                             | 554 s     | 5             | 1      | 19,751        | 28/33                         |
| Ollama, penalty 0                               | 965 s     | 5             | 2      | 20,975        | 29/33                         |

**Decision.**

- **Transport: Ollama with the schema in the prompt stays the default.** The adoption rule set in advance required zero off-schema replies _at comparable speed_. The grammar removes most bad replies but runs 53% slower here, with the same recall, and the one-round repair already absorbs most of Ollama's bad replies (1 failure in 30). `OpenAICompatibleProvider` stays available as `ENGRAM_PROVIDER=openai-compatible` for llama.cpp, LM Studio and vLLM users.
- **Sampling: the model's defaults stay.** The presence penalty doesn't explain the repairs (5 at every setting). Dropping it to 0 was 75% slower, with longer outputs and twice the failures, which matches the Qwen card's note that it prevents repetition. Structured calls send only `temperature 0` and `think: false`.
- **Output cap: `num_predict` 4,096 on every structured call** (no reply in the 120 measured calls reached it); capped replies are counted.
- **Question left open (P11, ledger row 37):** whether a compact output format would let both Gemini and local models drop the verbose time-hint objects. One wire format beats two.

**Consequences.**

- Local structured calls fail validation about 3% of the time after repair. Those turns contribute no facts, and their episodes are still stored and recallable.
- Runs aren't bit-reproducible (greedy decoding isn't a guarantee); the response cache makes reruns repeatable.
- The llama.cpp GGUF (5.7 GB) was deleted after the spike.

---

## ADR-017 — Embedding spaces are recorded per namespace, and similarity thresholds come from a per-model profile

**Date:** 2026-10-18 · **Status:** Accepted (P08b)

**Context.** Local mode embeds with embeddinggemma:300m (768-d, like gemini-embedding-2), but cosine scales differ between models: embeddinggemma scores related labels about 0.15 lower. Every similarity cut-off in Engram was tuned on Gemini, so reusing them on another model silently breaks entity resolution, conflict detection, entity search, consolidation and recall. Vectors from two models also can't be compared, so a namespace must never mix them.

**Decision.**

- **Each namespace records its embedding space** as `name@digest12` (`namespaces.embedding_model`, migration 0007; existing vector-bearing namespaces backfilled to `gemini-embedding-2`, null meaning "no vectors yet"). The first write binds it. A different space is refused with `EmbeddingSpaceError` until `pnpm db:reembed --namespace=` converts the namespace. `local:doctor` lists namespaces whose model changed (for example, after `ollama pull` moved a tag).
- **Thresholds live in `SIMILARITY_PROFILES[model]`** (`packages/core/src/config/profiles.ts`): entity match, description conflict, merge, entity search, drift and recall floor. Every read site takes the namespace's profile. An unknown model fails loudly instead of falling back to Gemini's values.
- **Profiles are calibrated from a labelled pair set that no embedder influences:** 537 pairs built from the dev personas' code-defined ground truth and dev-long's turns (`bench/calibration/pairs.ts`), never from test. `pnpm bench:calibrate --embedder=gemini|local` reports each family's error rates at a threshold and the lowest threshold with ≤1% false merges (`bench/calibration/<space>.json`). The script suggests a value; this ADR decides it.

embeddinggemma:300m@85462619ee72, at Gemini's thresholds vs the chosen profile:

| family               | Gemini value: false pos / false neg                        | same-class range       | other-class range      | chosen    | why                                                                                                                                                                                                                  |
| -------------------- | ---------------------------------------------------------- | ---------------------- | ---------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| entity match         | 0.85: 0 / 0.53                                             | 0.789–0.865            | 0.584–0.757            | **0.775** | the gap's middle; 0 false merges, all positives kept                                                                                                                                                                 |
| description conflict | 0.95: 0 / 1.00                                             | 0.816–0.880            | 0.766–0.847            | **0.848** | above every different-person pair; the 25% of same-person pairs below it go to disambiguation, which is safe                                                                                                         |
| merge                | 0.90: 0 / 0                                                | 0.950–0.997            | 0.645–0.810            | **0.90**  | already separates; keeps parity with Gemini                                                                                                                                                                          |
| entity search        | 0.70: 0 / 1.00                                             | 0.435–0.616            | 0.073–0.236            | **0.335** | the gap's middle; Gemini's value found nothing                                                                                                                                                                       |
| drift                | 0.50: 0.02 / 0.64                                          | p5 0.288               | p50 0.296              | **0.25**  | the classes overlap; splitting too rarely only makes a summary longer, splitting too often fragments sessions                                                                                                        |
| recall floor         | 0.50: abstains on 20/36 answerable items (dev-long, local) | answerable 0.363–0.710 | abstention 0.289–0.395 | **0.25**  | the classes overlap, as with Gemini (ADR-010): the floor is a safety net under every answerable item and the composer abstains. 0.30 would catch 2/4 abstention items with a 0.063 margin, too thin to carry to test |

**Consequences.**

- Switching embedders is an explicit conversion (`db:reembed`), never a silent mix.
- Adding an embedding model means running the calibration and adding a profile; the error says so.
- **Gemini's values, checked on the same pairs (2026-10-19, `bench/calibration/gemini-embedding-2.json`), stay as they are.** They are what dev-long validated end to end (100%, 0% duplicate entities), and no family shows an error that the engine doesn't already absorb:
  - entity match 0.85: misses 42% of same-entity label pairs and admits 2 of 87 different-entity pairs (highest 0.855). The embedding rung sits after exact-name and alias matching, and 0.856 would remove the two at no recall cost on these pairs, but with no end-to-end evidence either way it stays.
  - description conflict 0.95: sends every same-person pair to LLM disambiguation (positives 0.896–0.926). That is safe by design, at the cost of a call.
  - merge 0.90 and entity search 0.70 separate cleanly.
  - drift 0.50: consecutive turns score ≥ 0.587, so it never splits a session; cross-session pairs (≤ 0.679) also stay together. Splits come from session bounds, not drift.
- Drift has no clean threshold for embeddinggemma. Consolidation splits rarely, and summaries cover more turns.

---

## ADR-018 — Gemini's embedding quota counts texts; LongMemEval runs on local embeddings

**Date:** 2026-10-19 · **Status:** Accepted (P08)

**Context.** P08's budget assumed Gemini's free embedding quota (1,000 a day per project) counted requests, and that a `batchEmbedContents` call of up to 100 texts was one request. On 2026-10-19 the test run exhausted a fresh key after 277 requests carrying 1,019 texts. **The quota counts texts.** Batching saves nothing. That changes two things:

- **Test split:** Engram embeds about 17 texts an item (turns, facts, entity labels, the query). rag embeds every turn of every history, about 9,400 texts for test, because the bench cached whole requests: the same turn in a differently composed batch was paid for again.
- **LongMemEval-S (98 items):** 48,216 turns, **45,404 of them unique** (94%), about 11.3M tokens. With 4 keys (about 4,000 texts a day) that is about 11 days for one pass, before facts and queries.

**Decision.**

1. **The bench caches vectors per text** (`bench/runner/cache.ts`), as well as per request, and sends only texts it has never embedded. rag on test drops to at most the 1,343 unique turns. The engine is unchanged; this is a bench cost fix.
2. **The test split stays fully on Gemini** (generation and embeddings). It is the headline comparison, so it runs over two days of quota rather than change setup.
3. **LongMemEval runs with Gemini generation and local embeddings** (embeddinggemma:300m via Ollama, through `withEmbedder`). Every mode that embeds (engram, `engram_consolidated`, rag) uses the same embedder, so the comparison between modes stays like-for-like. buffer and full_context don't embed. Similarity thresholds follow the namespace's embedding space, so the calibrated embeddinggemma profile (ADR-017) applies automatically. Measured: 40 texts a second, so about 19 minutes for every unique turn; 0.1% of turns (38) exceed the 7,000-character cap and are truncated (ledger row 38).

**Alternatives considered** (researched 2026-10-19; free tiers only):

| option                                           | why not                                                                                                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Gemini embeddings, shrink the subset to fit      | ~8 items a day; a 50-item run takes a week, and §13.6's ≥50-item floor leaves no margin                                                         |
| OpenRouter `nvidia/nemotron-3-embed-1b:free`     | limits unverified (an aggregator lists ~200 requests a day); requests are logged and may train NVIDIA models; a new provider plus a calibration |
| OpenRouter `liquid/lfm-2.5-embedding-350m:free`  | 1,024-d and a 512-token input; may train Liquid models                                                                                          |
| Jina v3/v4 (dimension parameter allows 768)      | a one-time 10M-token grant (sources disagree; maybe 1M a month), below the 11.3M needed                                                         |
| Voyage-4 (~200M free tokens a month, unverified) | no 768-d output (256/512/1024/2048): a schema migration and a new validation                                                                    |
| Mistral `mistral-embed` (~1B tokens a month)     | 1,024-d only; the free plan may require opting in to training                                                                                   |
| Cloudflare Workers AI `bge-base` (768-d)         | 10k Neurons a day ≈ 1.65M tokens a day: about a week                                                                                            |
| Hugging Face Inference Providers                 | $0.10 a month in free credits                                                                                                                   |
| Nomic API (768-d)                                | about 1M tokens a month (unverified)                                                                                                            |

**Consequences.**

- **The LongMemEval number is "Gemini 3.5 flash-lite + embeddinggemma".** Every report header names both models, and the README must too. On dev-long, swapping Gemini embeddings for embeddinggemma under the same generator cost about 5 points (P08b rows B → C, 93% → 88%, with qwen generating). The LongMemEval Engram number is therefore probably a slight underestimate of an all-Gemini Engram.
- **The test split and LongMemEval use different embedders.** Their numbers aren't directly comparable, and the README says so.
- **Quotas are per key _and_ per model, so keys rotate per lane** (2c762bf). The provider had one current-key index for both generation and embeddings, so a key out of generate calls also stopped embedding, though it still had embedding quota. On 2026-10-19 a five-key rotation reached its last key early this way; four of the five keys still accepted embeddings minutes later. Embeddings and generation now rotate independently.
- **Planning embedding work means counting texts, not requests.** `pnpm bench --estimate` counts generate calls only; embedding cost is estimated from unique texts (as here) until the estimator counts them (ledger row 44).

---

## ADR-019 — The web API: one token model, event-streamed chat, quota-bounded demo

**Date:** 2026-10-19 · **Status:** Accepted (P09a)

**Context.** P09a gives Engram an HTTP surface on Vercel Hobby and Neon free tiers (SPEC §11). It has to authenticate agents, let anonymous visitors try a chat demo, and never let those visitors exhaust the free Gemini quota (~500 generate calls a day per key).

**Decisions and alternatives.**

1. **REST reuses `ENGRAM_MCP_TOKENS` (token → namespace) and drops `ENGRAM_API_TOKEN`** (ledger row 33). One auth model, compared in constant time by a shared `tokenResolver`, and REST is namespace-scoped like MCP. _Rejected:_ a single REST token, which would be all-namespaces or one-namespace with no way to give two agents separate memories.
2. **Chat streams server-sent events, not tokens.** The events are `memories` first, then `answer` (`text`, `supported`, `used_memory_ids`), then `done` / `error`. The composer returns zod-validated JSON with the used ids (CLAUDE.md: all LLM I/O is validated), and token streaming would mean showing unvalidated partial JSON. _Rejected:_ the AI SDK (a dependency for something `ReadableStream` does in 30 lines), and a plain-text answer followed by a separate ids call (an extra model call per turn).
3. **Demo identity: a random cookie secret; the namespace slug is its SHA-256.** Reading the database doesn't let anyone act as a visitor. _Rejected:_ storing the session id as the slug (a database leak becomes session hijack), and signed cookies (they need a key rotation story for no gain over a random secret).
4. **Limits.**
   - **Per IP:** 5 sessions an hour and 20 a day, keyed by `HMAC(secret, day ‖ ip)`, so no stored row identifies a visitor and keys rotate daily.
   - **Per namespace:** 30 chat turns an hour in `rate_limits`.
   - **Global:** a daily cap of 120 demo turns (~360 generate calls), in a new `throttles` table, because `rate_limits` is keyed by namespace.

   Each check is one atomic upsert, and a refused turn returns 429 before any model call. The global cap is the real bound on spend: rotating IPs can mint sessions, but not exceed it. _Rejected:_ a rate-limit library or Redis (a paid or extra service for counters Postgres already handles atomically).

5. **Route logic in `apps/web/src/server/`, built from injected dependencies** (`db`, `provider`, `config`, `clock`, `defer`). Tests call handlers with plain `Request`s, the FakeProvider and the local DB. They don't start Next and never touch the network. The `route.ts` files are wiring only.
6. **Post-response work goes through `defer` (Next's `after()`).** Chat registers it while the request is being handled. The task then waits on a promise the stream resolves with the stored episode ids, because `after()` must be called inside the request, not from a stream callback after the headers are sent. Losing that work is safe: unprocessed episodes are swept by `processPending` and the nightly jobs.
7. **Chat recalls before it stores the visitor's turn.** The plan stored first, but recall then found the question itself at similarity 1.0, which also defeated the abstention floor.
8. **Webpack, not Turbopack.** The engine uses NodeNext imports (`./client.js` for `client.ts`) and ships TypeScript source. Turbopack can't map `.js` to `.ts`; webpack's `resolve.extensionAlias` can, so `dev` and `build` pass `--webpack`. _Rejected:_ rewriting the engine's imports (breaks tsx, vitest and the stdio server) and compiling every package to `dist/`.
9. **`/api/evals` is public.** Bench summaries hold no personal data and are committed to the repo (SPEC §11 patch).
10. **Database client:** Neon's direct endpoint, `max: 1`, 20 s idle timeout, prepared statements off, pinned by a test (ledger row 6). _Rejected:_ the pooled endpoint, which resets the search path, so every transaction would have to set it.

**Consequences.**

- Unprocessed demo turns can lag if a function dies mid-`after()`; they're picked up later, never lost.
- The cap message is plain JSON with a 429, which the UI (P09b) must show without breaking the showcase.
- Turbopack's faster dev server isn't used until it supports extension aliasing.
