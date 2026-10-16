# P04 — Bench harness v0

**Status:** outline

> **Outline.** Expand this into the full template (see [README](README.md#full-template)) at the start of the phase, using what earlier phases learned. Don't build from the outline.

## Goal
Build Engram-Bench's machinery and its frozen 40-item dev split, so that every later tuning decision is measured instead of guessed. All four memory modes run end-to-end and produce a dev report. The test split is *not* generated yet.

## Spec refs
§13.1 (splits, item schema), §13.2 (registry-blind generator rules), §13.3 (runner, modes, quota-aware operation), §13.4 (judges), §13.5 (metrics), §13.7 (CI smoke), §6.3 (the shared composer is needed by every mode; a minimal version lands here and P05 finishes it), §15 P4.

## Depends on
P03: the full write path and as-of queries. Uses the P02 recorded-fixture mechanism for CI.

## Definition of done
- [ ] `bench/dataset/generate.ts` is seeded and deterministic, can't import the predicate registry (enforced by an eslint import restriction), and meets the §13.2 rules: ≥30% off-registry relations, paraphrased restatements, implicit updates.
- [ ] `dev.json` (40 items, mixed categories) is human-reviewed once and committed. Regenerating it never overwrites silently: the generator refuses to write if the file exists.
- [ ] The runner covers `buffer`, `rag`, `full_context` and `engram`, with a fresh `bench` namespace per item and historical `occurred_at` replay.
- [ ] LLM response cache keyed by (model, prompt hash), resumable runs, backoff, and a pre-run call and token estimate printed before starting.
- [ ] `exact` and `contains` judges are deterministic. The `llm` judge runs on Groq (a different family from Gemini).
- [ ] A dev report in `bench/reports/` covers all four modes, with the §13.5 metrics that make sense before P05 (accuracy per category, ad-hoc rate, duplicate-entity rate, calls and tokens per item, latency).
- [ ] CI smoke: a 20-item dev subset with exact/contains judges only, FakeProvider plus recorded fixtures, no network.

## Carried in from P02

- **Registry gaps.** The fixtures' ad-hoc rate was 34.5%, with `occupation` and `sibling_of` recurring. Measure the dev-split rate, and if it's above ~15% (SPEC §18), add those predicates before tuning retrieval.
- **Duplicate entities from nicknames** ("Rob" next to "Robert") are a real failure. Track the duplicate-entity rate with real embeddings; fixtures use fake ones.
- **Budget from flash-lite's free per-minute and per-day quotas** (ADR-005). Backoff already honours Gemini's RetryInfo.

- **Ad-hoc rate on re-recorded fixtures: 32.4%** (`has_occupation`, `job_title`, `profession` and `occupation` all appeared for one concept). It's a strong case for an `occupation` registry entry.

## Risks and verify-at-build-time
- **Verify:** Groq free-tier models and limits (fallbacks: Mistral, then Cohere), and Gemini RPM/RPD. On 2026-10-16 the Groq key listed no Llama chat models, only `openai/gpt-oss-120b`, `openai/gpt-oss-20b` and `qwen/qwen3.8-27b`. Any of these is a different family from Gemini; pick one, and update SPEC §14's "Llama family" wording. Write the expected wall-clock time of a full dev run into the report.
- **Who writes the dataset?** If an LLM generates the scenarios, use a different model or prompt context than extraction, and never show it the registry. The human review pass catches the rest.
- **`engram` mode before P05** uses naive retrieval. The v0 numbers are a baseline, not a claim.
- **Cache key correctness:** include the model id, the full prompt, the schema version and the temperature. A stale cache hit silently invalidates a run.
