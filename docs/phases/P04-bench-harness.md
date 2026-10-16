# P04 — Bench harness v0

**Status:** planned (expanded 2026-10-16)

## Goal
Build Engram-Bench's machinery and its frozen 40-item dev split, so every later tuning decision is measured rather than guessed. All four memory modes run end to end and produce a dev report. The test split is *not* generated yet (P08).

## Spec refs
§13.1–§13.5, §13.7, §6.3 (a minimal composer lands here; P05 finishes it), §14 (judge provider), §18 (ad-hoc rate, duplicate entities), §15 P4.

## Depends on / unlocks
- **Depends on:** P03 (full write path, `factsAsOf`).
- **Unlocks:** P05 (tuning needs the dev split and runner), P08 (test split, LongMemEval).

## Design decisions
1. **Ground truth is code; wording is a model.**
   - `dataset/personas.ts` builds seeded personas and dated timelines in plain TypeScript: moves, job changes, relationships, pets, preferences, out-of-order history, implicit updates.
   - Questions and expected answers are computed from that timeline, so every answer is exact by construction.
   - An LLM only verbalizes each session's facts into natural user turns (paraphrase, implicit phrasing). An automatic check confirms every required surface string appears.
   - The dataset code is registry-blind: an eslint rule forbids importing `@engram/core` there. At least 30% of relations are off-registry (pets, siblings, allergies, instruments…).
2. **Three model families.**
   - Gemini: the system under test (extraction, composition).
   - Qwen (`qwen/qwen3.8-27b` on Groq): verbalizes the dataset.
   - OpenAI `gpt-oss-120b` on Groq: the LLM judge, with strict JSON-schema output.

   All are free tiers.
3. **Personas share setups.** Several items ask different questions about the same persona history. Items still replay into fresh namespaces (§13.3), but identical turns hit the response cache. That makes a full dev run roughly 8 personas' worth of extraction plus about 160 compose calls, not 40 histories.
4. **Cache at the HTTP layer.**
   - `runner/cache.ts` is an injectable `fetch` keyed by `sha256(url without key + request body)`, one file per response in `bench/cache/` (gitignored).
   - It counts real calls, cached calls and tokens (from `usageMetadata`/`usage`) per item.
   - Embedding values are rounded to 6 decimals on write to keep entries small.
   - A read-only mode fails on a miss.
5. **CI smoke = recorded HTTP, no network.** A 20-item dev subset (exact/contains judges only) runs against a committed cache directory (`bench/fixtures/smoke-cache/`) in read-only mode. That's the real providers replaying real responses: no key, no cost. Recording it is an explicit `--record-smoke` act.
6. **Pacing.** A per-host pacer keeps under free per-minute limits (Gemini 12 RPM, Groq 25 RPM by default, configurable). Backoff honours RetryInfo/Retry-After. A daily-quota 429 stops the run cleanly; runs are resumable.
7. **Engram v0 retrieval** lives in the bench, not core. It ranks `factsAsOf(validAt, knownAt)` and record-time-filtered episodes by cosine to the question. P05 replaces it with core `recall()`.
8. **History is user turns only.** Setup sessions contain the user's turns: what memory is for, and half the extraction cost. Every mode sees the same turns, each prefixed with its date.

## Deliverables
```
bench/package.json                    # @engram/bench: bench, bench:generate, typecheck, test, lint
bench/dataset/schema.ts               # zod item schema (SPEC §13.1) + split file
bench/dataset/personas.ts             # seeded persona timelines (pure, registry-blind)
bench/dataset/questions.ts            # category question builders → items with exact answers
bench/dataset/verbalize.ts            # Qwen: session facts → user turns, plus surface-string check
bench/dataset/generate.ts             # CLI; refuses to overwrite an existing split
bench/dataset/dev.json                # frozen, 40 items
bench/runner/{cache,pacer,modes,judge,run,report,estimate,cli}.ts
bench/fixtures/smoke-cache/           # committed recorded responses for the CI smoke subset
bench/reports/<date>-dev.md
packages/core/src/providers/groq.ts   # Groq provider: generate + judge
packages/core/src/providers/gemini.ts # + compose
```

## Tasks
1. Scaffold the `@engram/bench` package, its item schema, and the eslint import restriction for `bench/dataset/`.
2. Persona timelines and question builders (pure, with unit tests on determinism and answer correctness).
3. Groq provider in core (strict JSON schema, backoff, judge), plus the minimal Gemini composer (§6.3: untrusted memory block, `{answer, supported, usedMemoryIds}`, "I don't know" when unsupported).
4. Caching fetch, pacer, and usage accounting.
5. Verbalizer and generate CLI. Generate `dev.json`, run the automatic checks, then a review pass.
6. Runner: four modes, fresh namespace per item, historical replay on a simulated clock, judges, resumable per-item results in `bench/runs/` (gitignored).
7. Report and pre-run estimate.
8. First full dev run, and the report committed.
9. Smoke subset: record it and add the CI step.

## Tests
- **Personas:** the same seed gives the same timeline; different seeds differ; ≥30% of relations are off-registry, checked against a hard-coded list in the test, not the registry.
- **Questions:** each category's expected answer matches the timeline (e.g. a `valid_at` before the move gives the old city; `known_at` before the update was said gives the old value).
- **Cache:** hit, miss, read-only miss error, key ignores the API key, embedding rounding.
- **Judges:** exact and contains normalization, abstention detection, and the LLM judge via FakeProvider.
- **Modes:** buffer/rag/full_context/engram on a tiny item with FakeProvider. Engram respects `valid_at`/`known_at`.
- **Runner:** resumability (an existing per-item result is skipped) and quota-stop behaviour.

## Definition of done
- [ ] `dev.json` (40 items, mixed categories) is generated, checked automatically, reviewed, and committed. The generator refuses to overwrite it.
- [ ] The runner covers all four modes, with a fresh `bench` namespace per item and historical `occurred_at` replay.
- [ ] Cache, resumability, pacing, backoff, and the pre-run call/token estimate.
- [ ] Exact/contains judges are deterministic; the LLM judge runs on Groq `gpt-oss-120b`.
- [ ] A dev report covering all four modes: accuracy per category, ad-hoc rate, duplicate-entity rate, abstention precision/recall, calls and tokens per item, latency. Retrieval recall@8 is deferred to P05, which has the relevance labels.
- [ ] CI smoke: 20 dev items, exact/contains only, replayed from committed recordings with no network.

## Planned commits
1. `chore(bench): scaffold bench package and item schema`
2. `feat(bench): generate seeded persona timelines and questions`
3. `feat(core): add groq judge provider and gemini composer`
4. `feat(bench): add response cache, pacing and usage accounting`
5. `feat(bench): verbalize sessions and freeze the dev split`
6. `feat(bench): run four memory modes with judges and resumability`
7. `feat(bench): report dev results and estimate runs`
8. `chore(ci): run the bench smoke subset from recorded responses`

## Free-tier notes
- **A full dev run is about 80 extraction calls and 160 compose calls** on `gemini-3.5-flash-lite`, plus about 40 Groq judge calls. Generation is about 30 Qwen calls, once.
- **Pacing at 12 RPM makes a cold dev run take about 25 minutes.** Re-runs with unchanged prompts are nearly free.
- **Groq's 8K tokens per minute** is the binding judge limit. Judge prompts stay short.

## Risks and verify-at-build-time
- **Free-tier daily limits for flash-lite aren't published** (AI Studio only). The runner reports the quota it hit and stops resumably.
- **Verbalization can drop or alter a fact.** The surface-string check catches dropped names and values; the review pass catches meaning drift.
- **Fake embeddings are not used in the bench.** Entity-resolution and rag numbers are real-embedding numbers.
- **The bench's own judge can be wrong.** Hand-labelled agreement is P08.

## Carried in from P02/P03
- **Registry gaps.** The ad-hoc rate was 34.5%, then 32.4% after re-recording (occupation in four spellings). Measure it on dev; if above ~15% (SPEC §18), add `occupation` (and likely `sibling_of`) before tuning retrieval.
- **Duplicate entities from nicknames** ("Rob" next to "Robert"). Track the duplicate-entity rate with real embeddings.
- **Budget from flash-lite's free quotas** (ADR-005). Backoff already honours RetryInfo.
