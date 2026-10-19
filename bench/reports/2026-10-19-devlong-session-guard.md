# Engram-Bench — dev-long split, run 2026-10-19-devlong-session-guard

2026-10-19 · system model `gemini-3.5-flash-lite` · judge `openai/gpt-oss-120b` · 40 items

## Accuracy by category

| category | n | engram |
|---|---|---|
| cross_session_recall | 12 | 100% |
| knowledge_update | 8 | 100% |
| temporal_reasoning | 6 | 100% |
| single_session_recall | 6 | 100% |
| multi_hop | 4 | 100% |
| abstention | 4 | 100% |
| **all** | 40 | **100%** |

## Retrieval recall@8

Share of answerable items where a retrieved memory contains the expected answer (automatic labels; a paraphrased answer counts as a miss).

| mode | recall@8 | n |
|---|---|---|
| engram | 97% | 36 |

## Abstention floor simulation (run floor 0.5)

| floor | accuracy | abstention recall | wrongly abstained |
|---|---|---|---|
| 0.5 | 100% | 100% | 0 |
| 0.55 | 100% | 100% | 0 |
| 0.6 | 100% | 100% | 0 |
| 0.65 | 100% | 100% | 0 |
| 0.7 | 100% | 100% | 0 |

## Abstention and cost

| mode | abstention precision | abstention recall | real calls / item | cached / item | prompt tokens / item | latency p50 | latency p95 |
|---|---|---|---|---|---|---|---|
| engram | 100% | 100% | 4.0 | 23.3 | 3601 | 4954 ms | 71327 ms |

Latency includes cache hits, so it understates cold runs. Real calls and tokens count only what this run sent to the network.

## Engram store health

- Ad-hoc predicate rate: 0% of current facts (SPEC §18 threshold ~15%).
- Duplicate-entity rate: 0% of entities share a name with another.
- Adjudication rate: 3% of fact revisions were decided by the LLM adjudicator rather than the rules.

## System model reliability

Counted over the last invocation, cache replays included, so replaying a run from cache recounts it exactly.

- Structured calls: 470.
- Needed a repair round: 9 (2%); failed after it: 0 (0%). A failed session pack is re-extracted turn by turn; a failed turn adds no facts.
- Texts truncated before embedding: 0.

## Misses

