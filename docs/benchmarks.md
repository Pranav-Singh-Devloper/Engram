# Benchmarks (draft for the README, P10)

Every number here comes from a committed report in `bench/reports/` (named per table) and was produced by `pnpm bench`. Nothing was tuned on the test split or on LongMemEval; tuning used the dev splits only (CLAUDE.md). Dates are 2026-10-18/19.

## Setup

| | test split | LongMemEval-S subset |
|---|---|---|
| items | 200, frozen (`bench/dataset/test.json`, §13.1 category counts, 40 personas) | 98, stratified by question type, abstention in proportion (`bench/longmemeval/subset.json`) |
| history per item | median 48 turns (4 story sessions + 12 filler sessions) | ~470 turns (~115k tokens) |
| generation | Gemini 3.5 flash-lite | Gemini 3.5 flash-lite |
| embeddings | gemini-embedding-2 | **embeddinggemma:300m, local** (ADR-018: Gemini's free tier counts every embedded text, and the subset's 45,404 unique turns would take ~11 days of quota) |
| Engram extraction | one call per session (ADR-015) | packed: several sessions per call (ADR-015), to fit the free quota |
| judge | Groq `openai/gpt-oss-120b` for open answers; exact or contains matching where the answer is a value | same; this is **our judge, not the paper's GPT-4o** |
| report | `2026-10-18-test.md` | `2026-10-19-longmemeval.md` |

Modes:
- **buffer:** the last 20 turns.
- **rag:** top 8 turns by embedding similarity.
- **full_context:** the whole history in the prompt.
- **engram:** recall over facts and episodes.
- **engram_consolidated:** engram after nightly consolidation.

All five use the same composer prompt.

## Accuracy, test split

| category | n | buffer | rag | full_context | engram | engram_consolidated |
|---|---|---|---|---|---|---|
| cross-session recall | 60 | 13% | 100% | 100% | 100% | 100% |
| knowledge update | 40 | 93% | 100% | 100% | 98% | 100% |
| temporal reasoning | 30 | 80% | 100% | 97% | 100% | 97% |
| single-session recall | 30 | 100% | 100% | 100% | 100% | 100% |
| multi-hop | 20 | 0% | 100% | 100% | 100% | 100% |
| abstention | 20 | 100% | 100% | 100% | 100% | 100% |
| **all** | 200 | **60%** | **100%** | **100%** | **100%** (199/200) | **100%** |

recall@8 (an answerable item's expected value appears in a retrieved memory): rag 96%, engram 96%, engram_consolidated 99%.

**Reading it.** The test split separates buffer from everything else and nothing more. Its histories (~48 turns) fit in one prompt, so full_context and rag saturate alongside Engram. It shows Engram is correct on the categories it was built for (knowledge updates, temporal questions, abstention). It does not show Engram beating the baselines.

## Accuracy, LongMemEval-S (98 items)

| category | n | buffer | rag | full_context | engram |
|---|---|---|---|---|---|
| cross-session recall (multi-session) | 24 | 0% | 38% | 38% | 29% |
| knowledge update | 14 | 14% | 79% | 64% | 64% |
| temporal reasoning | 25 | 0% | 40% | 48% | 32% |
| single-session recall | 30 | 3% | 53% | 63% | 50% |
| abstention | 5 | 100% | 100% | 80% | 100% |
| **all** | 98 | **8%** | **52%** | **54%** | **45%** |

recall@8: rag 51%, engram 45%. `engram_consolidated` on LongMemEval is pending (ledger row 46: about 4,500 summary calls, two days of free quota).

**Reading it.** Engram trails rag by 7 points and full_context by 9. The reasons, in order of evidence:

1. **Engram distills; these questions need raw detail.** Packed extraction keeps about 25 facts per 470-turn history. LongMemEval mostly asks about one throwaway turn ("what kitchen gadget did I buy before the air fryer?"). rag ranks raw turns by similarity alone. Engram's fused list puts distilled facts beside turns, so the one detail turn more often misses the top 8 (recall@8 45% vs 51%).
2. **Two handicaps measured on dev-long:**
   - local embeddings cost about 5 points (P08b rows B → C: 93% → 88%);
   - packed extraction cost about 5 (session 100% vs packed 95%).

   Both were forced by free-tier quotas, and both apply to Engram only.
3. **Abstention:** Engram and rag abstain correctly on all 5 unanswerable items; full_context answers one of them.

## Cost per item

Model requests per item, counting generate and embedding requests, whether sent or replayed from the bench cache. Prompt tokens are those sent to the generation model.

| | buffer | rag | full_context | engram | engram_consolidated |
|---|---|---|---|---|---|
| test: requests / item | 1.0 | 3.0 | 1.0 | 33.8 | 45.0 |
| LongMemEval: requests / item | 1.0 | 10.2 | 1.0 | 64.4 | pending |
| LongMemEval: prompt tokens / question | 2,026 | 1,057 | **48,432** | about 1,000 (see note) | |

**Reading it.** The costs fall at different times.
- **Engram** pays at ingest: one extraction per session, embeddings, resolution, done once. A question then costs one query embedding plus one compose call over at most 8 memories, about rag's prompt size.
- **full_context** pays on every question, and its prompt grows with the history: ~1.5k tokens on test, ~48k on LongMemEval. Free-tier rate limits cap that at a few questions a minute.

Engram's per-item request count is mostly ingest, which a real deployment spreads over every later question. Note: the bench report's prompt-token column for Engram counts uncached ingest calls too, so the per-question figure above is the compose prompt's size (~8 memories), not that column.

## Judge validity

Two sheets of LLM-judged answers were hand-labelled blind (the judge's verdicts were hidden until the end): 10 from the test split and 30 from LongMemEval, sampled across modes and categories. Abstentions are excluded, since a fixed rule scores those, not the judge.

| | labelled | correct / incorrect | agreement | Cohen's κ |
|---|---|---|---|---|
| test | 10 | 10 / 0 | 100% | undefined (one class) |
| LongMemEval | 30 | 23 / 7 | 100% | 1.00 |
| **pooled** | **40** | **33 / 7** | **100%** | **1.00** |

The judge was never too lenient or too strict on these 40 answers (`bench/reports/agreement-2026-10-18-test+2026-10-19-longmemeval.md`). Forty answers is a small sample: this says the judge isn't systematically off, not that it's perfect.

## Local mode (dev-long, 40 items)

From `docs/local.md`: A (all Gemini) 100%, B (qwen3.5:9b + Gemini embeddings) 93%, C (fully local) 88%, C′ (fully local with the time-reference extraction rule, now merged) 95%. recall@8 is 97% in every row.

## Limitations to state in the README

- The test split saturates (above); LongMemEval is the discriminating benchmark, and there Engram trails rag and full_context.
- LongMemEval ran with local embeddings and packed extraction, both forced by free quotas and both measured to cost Engram points.
- Consolidation occasionally infers weak facts: 10 distinct inserted statements on test, against 3,077 merges. Three were weak ("The user visited Melbourne", "The user visited Nairobi", "Olive likes Porto"). None appeared in a wrong answer (ledger row 28).
- The judge is Groq's `gpt-oss-120b`, validated on 40 hand labels, not GPT-4o as in the LongMemEval paper.
- Results are from single runs. Model replies are cached, so reruns are repeatable, but there are no confidence intervals.
