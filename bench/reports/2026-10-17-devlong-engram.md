# Engram-Bench — dev-long split, run 2026-10-17-devlong-engram

2026-10-17 · system model `gemini-3.5-flash-lite` · judge `openai/gpt-oss-120b` · 40 items

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

## Abstention floor simulation (run floor 0)

| floor | accuracy | abstention recall | wrongly abstained |
|---|---|---|---|
| 0 | 100% | 100% | 0 |
| 0.3 | 100% | 100% | 0 |
| 0.4 | 100% | 100% | 0 |
| 0.45 | 100% | 100% | 0 |
| 0.5 | 100% | 100% | 0 |
| 0.55 | 100% | 100% | 0 |
| 0.6 | 100% | 100% | 0 |
| 0.65 | 100% | 100% | 0 |
| 0.7 | 100% | 100% | 0 |

## Abstention and cost

| mode | abstention precision | abstention recall | real calls / item | cached / item | prompt tokens / item | latency p50 | latency p95 |
|---|---|---|---|---|---|---|---|
| engram | 100% | 100% | 0.3 | 76.8 | 130 | 224 ms | 5391 ms |

Latency includes cache hits, so it understates cold runs. Real calls and tokens count only what this run sent to the network.

## Engram store health

- Ad-hoc predicate rate: 0% of current facts (SPEC §18 threshold ~15%).
- Duplicate-entity rate: 0% of entities share a name with another.

## Misses

