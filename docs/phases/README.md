# Build phases

The plan for building Engram, one file per phase. [`docs/SPEC.md`](../SPEC.md) is the source of truth. These files say *how and in what order*, and they cite spec sections instead of restating them. When a phase changes something the spec defines, the spec is updated in the same phase.

## Phases

| Phase | File | Status | Depends on | Done when |
|---|---|---|---|---|
| P00 Scaffold | [P00-scaffold.md](P00-scaffold.md) | done | — | typecheck, test and lint are green locally and in CI; a fresh clone boots the DB |
| P01 Store + providers | [P01-store-providers.md](P01-store-providers.md) | done | P00 | repository tests pass, including the pgvector round-trip and CHECK rejections |
| P02 Extraction + entities | [P02-extraction-entities.md](P02-extraction-entities.md) | done | P01 | golden fixtures, the concurrency test and the two-Sams fixture pass |
| P03 Conflict + temporal | [P03-conflict-temporal.md](P03-conflict-temporal.md) | done | P02 | the §7.4 suite (14 cases) passes; `pnpm demo:offline` works with no keys |
| P04 Bench harness v0 | [P04-bench-harness.md](P04-bench-harness.md) | done | P03 | all four modes produce a dev report |
| P05 Retrieval | [P05-retrieval.md](P05-retrieval.md) | done | P04 | retrieval fixtures pass; dev targets are recorded in DECISIONS.md |
| P06a Decay + purge | [P06a-decay-purge.md](P06a-decay-purge.md) | done | P05 | the time-travel and purge tests pass |
| P06b Consolidation + jobs | [P06b-consolidation-jobs.md](P06b-consolidation-jobs.md) | done | P06a | consolidation runs end-to-end on the local DB; the merge test passes |
| P07 MCP | [P07-mcp.md](P07-mcp.md) | done | P06b | the SDK-client integration test passes; Claude Code can remember and recall |
| P08 Bench full | [P08-bench-full.md](P08-bench-full.md) | done | P07 | test and LongMemEval reports exist; the README table shows judge agreement |
| P08b Local mode | [P08b-local-mode.md](P08b-local-mode.md) | done | P08 (runs in its quota waits) | Engram's processing works with no third-party call; dev-long ablation report |
| P09a Web API | [P09a-web-api.md](P09a-web-api.md) | done | P07 | route handlers, auth, demo sessions and rate limits are tested |
| P09b Web UI | [P09b-web-ui.md](P09b-web-ui.md) | outline | P09a | `docs/demo.md` can be followed without improvising |
| P10 Ship | [P10-ship.md](P10-ship.md) | outline | P08, P09b | three reviewer paths are verified from a fresh clone; the hosted demo is live |
| P11 Local mode, extended | (outline in P08b) | outline | P10 | compact format, chunked embeddings, local goldens, test/LME local runs, light profile |

Statuses are `outline` → `planned` → `in progress` → `done`. P08 and P09a/b can overlap if bench runs are waiting on quota.

## The loop for every phase

1. **Expand.** If the file is still an outline, rewrite it into the full template (below) using what earlier phases taught us. Update the spec if the plan changes it.
2. **Approve.** Review the expanded plan before any code is written.
3. **Build.** Work in small steps. Engine logic gets its tests first or alongside.
4. **Gate.** Before every commit: `pnpm -r typecheck && pnpm -r test && pnpm -r lint`.
5. **Commit.** 3–8 Conventional Commits per phase, one logical change each (spec §16).
6. **Close.** Tick the DoD, set the status to `done`, and write a 3–5 line summary at the bottom of the file. Every follow-up becomes a row in the [carried-items ledger](#carried-items-ledger) *and* a task or DoD item in its target phase's file.
7. **Carried items must land.** When expanding a phase, pull every open ledger row targeting it into its tasks and DoD. A phase can't close while a row targeting it is open, unless the row is re-shifted with a reason.

## Full template

A phase file that is ready to build has these sections:

1. Goal
2. Spec refs
3. Depends on / unlocks
4. Scope: in and out
5. Deliverables
6. Tasks: ordered, each roughly one commit
7. Tests
8. Definition of done: checkable boxes
9. Planned commits
10. Free-tier notes
11. Risks and verify-at-build-time

## Rules that apply to every phase

- **Free only.** Every service is a free tier or a free trial. If a step can't fit a free quota, shrink the step and record an ADR. Never add a paid dependency.
- **Dependencies need approval.** Each new package comes with a one-line justification, approved at phase start.
- **Unit tests never hit the network.** They use FakeProvider. Integration tests (`*.int.test.ts`) use the local Docker DB, never a hosted one.
- **Fact rows are immutable versions.** Queries filter on time columns, never on `status` (§5.1).
- **Tune on dev only.** Never on test (§13.1).
- **ADRs.** Every significant choice gets a ≤10-line entry appended to `DECISIONS.md`.
- **Commit hygiene.** No Co-Authored-By or "generated with" lines, and no force-push after publishing (§16).

## Free-tier budget

Verify every figure at the start of the phase that first needs it. Free quotas change often.

| Service | Used for | First needed | Budget concern |
|---|---|---|---|
| Docker `pgvector/pgvector` | local dev, tests, CI | P00 | none (disk only, ~400 MB) |
| GitHub Actions | CI, bench, nightly consolidation | P00 | minutes are unlimited for public repos; schedules pause after 60 days of inactivity |
| Gemini API (AI Studio) | embeddings, extraction, compose, adjudicate, summarize | P01 | flash-lite: 500 requests/day (measured), reset at midnight Pacific; plan runs within one day |
| Groq (`gpt-oss-120b` judge, `qwen3.8-27b` verbalizer) | bench judge, dataset wording | P04 | 30 RPM, 1K RPD, 8K TPM; fallbacks are Mistral, then Cohere |
| Neon free tier (ADR-014) | hosted DB | P07 (connected 2026-10-17) | 1 GB storage, 100 CU-hours and 5 GB egress a month, scale to zero after 5 min. Never run the bench against it |
| Vercel Hobby | web, API, HTTP MCP | P09a | function duration and invocation limits |

## Carried-items ledger

Every item a phase deferred or put on hold, with where it landed. Rows are never deleted. A re-shifted row keeps its history in the status column.

| # | Item | From | To | Status |
|---|---|---|---|---|
| 1 | Shared DB client and migrator in core | P00 | P01 | done (P01) |
| 2 | Pick `GEMINI_CHAT_MODEL` | P01 | P02 | done (ADR-005) |
| 3 | Judge as a separate (Groq) provider | P01 | P04 | done (P04) |
| 4 | Restore archived facts when recall hits them | P01 | P05 | done (P05) |
| 5 | Use the `rate_limits` table | P01 | P09a | done (P09a: 30 chat turns an hour per namespace, `takeChatTurn`) |
| 6 | `prepare: false` for the transaction pooler, with a test | P01 | P09a | done (P09a: `WEB_DB_OPTIONS` pinned by `db.test.ts`) |
| 7 | Unknown `valid_from` for end-only facts | P02 | P03 | done (ADR-007) |
| 8 | Assistant echoes merge, raising confidence only for new episodes | P02 | P03 | done (P03) |
| 9 | Fixture 04 correction retracts Initech | P02 | P03 | done (P03) |
| 10 | `engram_remember` returns the processing summary | P02 | P07 | done (P07) |
| 11 | Tune the merge threshold (0.9) | P03 | P05 → P08 | done (P08, 2026-10-18): on dev-long, no paraphrase splits; the closest *distinct* values (Initech vs Globex) score 0.893, so lowering 0.9 would merge different employers. Kept at 0.9 |
| 12 | Report the adjudication rate | P03 | P04 → P08 | done (P08, ae1e68d): in every report's store health; test 0%, LongMemEval 2% |
| 13 | Document that multi-instance deploys need synced clocks | P03 | P10 | open (README limitations) |
| 14 | Registry gaps (`occupation`, `sibling_of`) | P04 | P05 | done (ad-hoc 34% → 0%) |
| 15 | Nickname duplicates ("Rob" next to "Robert") | P02 | P04 → P10 | tracked: duplicate-entity rate is 0% on dev and dev-long; no fix. Listed as a limitation in P10 |
| 16 | Retrieval recall@8 with relevance labels | P04 | P05 | done (P05) |
| 17 | Hand-labelled judge agreement | P04 | P08 | done (P08): 40 blind labels (10 test, 30 LongMemEval; 33 correct, 7 incorrect), 100% agreement, pooled κ 1.00 |
| 18 | Longer histories vs one extraction call per turn (batching decision) | P04, P05 | P08 | done (P08, ADR-015: session extraction for the bench, packed for LongMemEval; per-turn stays for live writes) |
| 19 | Budget 10% above the cache-based call count | P05 | P08 | done (P08: estimates carry the margin; dev-long parity cost 141 calls against 136 estimated) |
| 20 | MCP recall tracks access to everything returned | P05 | P07 | done (P07, tested) |
| 21 | Chat tracks access via `usedMemoryIds` | P05 | P09a | done (P09a: only facts the composer used; `chat.int.test.ts`) |
| 22 | Prompt pass: fixture 08 maps the brother to `partner_of` | P05 | P08 | done (P08, 3d84aab: fixtures and smoke cache re-recorded) |
| 23 | Regenerate purged summaries; re-embed redacted turns | P06a | P06b | done (P06b) |
| 24 | pg_cron schedules for decay and demo cleanup | P06a | P06b | done (P06b), then replaced by `jobs:maintain` in `nightly.yml` (ADR-014) |
| 25 | Verify pg_cron on Supabase (`select * from cron.job`) | P06b | P10 | re-shifted: no pg_cron on Neon (ADR-014). P10 instead checks that a `nightly.yml` run sweeps and consolidates on Neon |
| 26 | `engram_forget` modes and stats' "last sweep" | P06a | P07 | done (P07) |
| 27 | Prompt pass: summaries say "the user", never he/she | P06b | P08 | done (P08, 3d84aab) |
| 28 | Watch weak inferred facts (`visited`) on test | P06b | P08 | done (P08): consolidation inserted 43 facts vs 3,077 merges on test, 10 distinct; 3 weak (two `visited`, "Olive likes Porto"), none in a wrong answer. A README limitation, not a fix |
| 29 | README: re-enable paused scheduled workflows, and Neon's monthly compute/egress limits | P06b | P10 | open (P10 DoD; Supabase pausing no longer applies) |
| 30 | Smoke cache size (4.2 MB) | P04 | P08 | done (P08: 4.0 MB after the 9d46231 re-record with session mode added; the ~6 MB trigger for compact vectors wasn't reached) |
| 31 | `/graph` page | P09b | P09b | stretch, only if P10 is on track |
| 32 | Recall ranks "Ana lives in Porto" above "The user lives in Lisbon" for "where does the user live" (Inspector session) | P07 | P08 | done (P08, 2026-10-18): a self-subject prior was tested on dev-long retrieval-only runs at weights 0 / 0.15 / 0.3: MRR 0.760 / 0.749 / 0.760, top-1 21 / 22 / 23 of 36, i.e. noise. Kept off (`recall.selfWeight: 0`), available as an option |
| 33 | Decide whether the REST endpoints' bearer reuses `ENGRAM_MCP_TOKENS` (one namespace per token) or keeps a single `ENGRAM_API_TOKEN` | P07 | P09a | done (P09a, ADR-019: REST reuses `ENGRAM_MCP_TOKENS`; `ENGRAM_API_TOKEN` removed) |
| 34 | Node: MCP Inspector 2.11 requires ≥ 22.19; the repo pins 22 via `.node-version`. Bump to the current 22 LTS and re-check the fresh clone | P07 | P10 | open (P10 DoD) |
| 35 | Neon's pooled endpoint resets the search path (verified after a compute restart). Vercel uses the direct endpoint, unless traffic needs the pooler and every transaction then sets the path | Neon setup | P09a | done (P09a: a deployed preview's `/api/health` resolved unqualified names to `engram` on the direct endpoint) |
| 36 | GitHub secrets for `nightly.yml` (`HOSTED_DATABASE_URL`, Gemini keys) | Neon setup | P08 | done (set 2026-10-17; a dispatched nightly run succeeded on Neon) |
| 37 | Compact output format for local models; format ablation; whether Gemini adopts it (ADR-016 question) | P08b | P11 | open |
| 38 | Chunked embeddings for turns over the embedder's input limit (evidence: P08b truncation rate) | P08b | P11 | open |
| 39 | Local golden fixtures (`expected-local/`, "behavioral snapshots, not ground truth") with CI replay | P08b | P11 | open |
| 40 | Test-split local run (all modes) and a 10-item LongMemEval local smoke run | P08b | P11 | open |
| 41 | qwen3.5:4b "light" profile for 8–16 GB machines, measured first | P08b | P11 | open |
| 42 | OpenAICompatibleProvider for other runtimes (unless the P08b llama.cpp spike adopts it) | P08b | P11 → P08b | done (P08b): built for the spike; `ENGRAM_PROVIDER=openai-compatible` (llama.cpp, LM Studio, vLLM) |
| 43 | Prompt pass: a clause that only places another fact in time isn't a new statement. Add to the candidate rules: "A clause that only places another fact in time isn't a new statement. In \"Before I moved to Lyon, I lived in Rome from 2015 to 2018\", extract lives_in Rome with its dates, not lives_in Lyon: Lyon is a reference point, already known." Evidence: dev-long local 88% → 95% (knowledge update 4/8 → 7/8; reports `2026-10-18-devlong-local-C*`). Lands as a second prompt pass (rows 22 and 27 went in 3d84aab): re-record the Gemini goldens and smoke cache, rerun dev-long row A for no regression, all before the P08 test run | P08b | P08 | done (P08, 9d46231: goldens and smoke re-recorded, CI replays session mode; dev-long row A rerun 100%, recall@8 97%) |
| 44 | `bench --estimate` counts embedded texts too, not just generate calls (Gemini's free quota counts texts; ADR-018) | P08 | P10 | open (P10: a reviewer running the bench needs a true estimate) |
| 45 | Production deploy through Vercel's Git integration (a CLI deploy uploads the working tree); remove or replace the unconfigured Production deployment the P09a preview step created by accident; apply every pending migration to Neon (0007 had been missed until P09a); first live chat turn as a smoke test | P09a | P10 | open (P10 deploy checklist) |
| 46 | LongMemEval `engram_consolidated` (one summary per session: ≤4,458 Gemini calls, about two days of five keys' generation quota). SPEC §13.6 requires engram and full_context there; consolidation is measured on dev-long and test. Run in the background after P08 closes; add to the LongMemEval report when it lands | P08 | P10 | open (P10: before the README tables are final) |

