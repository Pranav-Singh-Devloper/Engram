# Build phases

The plan for building Engram, one file per phase. [`docs/SPEC.md`](../SPEC.md) is the source of truth. These files say *how and in what order*, and they cite spec sections instead of restating them. When a phase changes something the spec defines, the spec is updated in the same phase.

## Phases

| Phase | File | Status | Depends on | Done when |
|---|---|---|---|---|
| P00 Scaffold | [P00-scaffold.md](P00-scaffold.md) | done | — | typecheck, test and lint are green locally and in CI; a fresh clone boots the DB |
| P01 Store + providers | [P01-store-providers.md](P01-store-providers.md) | planned | P00 | repository tests pass, including the pgvector round-trip and CHECK rejections |
| P02 Extraction + entities | [P02-extraction-entities.md](P02-extraction-entities.md) | planned | P01 | golden fixtures, the concurrency test and the two-Sams fixture pass |
| P03 Conflict + temporal | [P03-conflict-temporal.md](P03-conflict-temporal.md) | planned | P02 | the §7.4 suite (14 cases) passes; `pnpm demo:offline` works with no keys |
| P04 Bench harness v0 | [P04-bench-harness.md](P04-bench-harness.md) | outline | P03 | all four modes produce a dev report |
| P05 Retrieval | [P05-retrieval.md](P05-retrieval.md) | outline | P04 | retrieval fixtures pass; dev targets are recorded in DECISIONS.md |
| P06a Decay + purge | [P06a-decay-purge.md](P06a-decay-purge.md) | outline | P05 | the time-travel and purge tests pass |
| P06b Consolidation + jobs | [P06b-consolidation-jobs.md](P06b-consolidation-jobs.md) | outline | P06a | consolidation runs end-to-end on the local DB; the merge test passes |
| P07 MCP | [P07-mcp.md](P07-mcp.md) | outline | P06b | the SDK-client integration test passes; Claude Code can remember and recall |
| P08 Bench full | [P08-bench-full.md](P08-bench-full.md) | outline | P07 | test and LongMemEval reports exist; the README table shows judge agreement |
| P09a Web API | [P09a-web-api.md](P09a-web-api.md) | outline | P07 | route handlers, auth, demo sessions and rate limits are tested |
| P09b Web UI | [P09b-web-ui.md](P09b-web-ui.md) | outline | P09a | `docs/demo.md` can be followed without improvising |
| P10 Ship | [P10-ship.md](P10-ship.md) | outline | P08, P09b | three reviewer paths are verified from a fresh clone; the hosted demo is live |

Statuses are `outline` → `planned` → `in progress` → `done`. P08 and P09a/b can overlap if bench runs are waiting on quota.

## The loop for every phase

1. **Expand.** If the file is still an outline, rewrite it into the full template (below) using what earlier phases taught us. Update the spec if the plan changes it.
2. **Approve.** Review the expanded plan before any code is written.
3. **Build.** Work in small steps. Engine logic gets its tests first or alongside.
4. **Gate.** Before every commit: `pnpm -r typecheck && pnpm -r test && pnpm -r lint`.
5. **Commit.** 3–8 Conventional Commits per phase, one logical change each (spec §16).
6. **Close.** Tick the DoD, set the status to `done`, write a 3–5 line summary at the bottom of the file, and note any follow-ups in the next phase's file.

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
| Gemini API (AI Studio) | embeddings, extraction, compose, adjudicate, summarize | P01 | requests per minute and per day; bench runs may span several days |
| Groq (Llama) | bench judge | P04 | daily request and token caps; fallbacks are Mistral, then Cohere |
| Supabase free tier | hosted DB, pg_cron | P10 (optional earlier) | 500 MB DB; pauses after inactivity |
| Vercel Hobby | web, API, HTTP MCP | P09a | function duration and invocation limits |
