# Engram-Bench — dev-long split, run 2026-10-18-devlong-local-C-counted

2026-10-18 · system model `ollama qwen3.5:9b` · judge `openai/gpt-oss-120b` · 40 items

## Accuracy by category

| category | n | engram |
|---|---|---|
| cross_session_recall | 12 | 100% |
| knowledge_update | 8 | 50% |
| temporal_reasoning | 6 | 83% |
| single_session_recall | 6 | 100% |
| multi_hop | 4 | 100% |
| abstention | 4 | 100% |
| **all** | 40 | **88%** |

## Retrieval recall@8

Share of answerable items where a retrieved memory contains the expected answer (automatic labels; a paraphrased answer counts as a miss).

| mode | recall@8 | n |
|---|---|---|
| engram | 97% | 36 |

## Abstention floor simulation (run floor 0.25)

| floor | accuracy | abstention recall | wrongly abstained |
|---|---|---|---|
| 0.3 | 88% | 100% | 0 |
| 0.4 | 78% | 100% | 4 |
| 0.45 | 58% | 100% | 16 |
| 0.5 | 48% | 100% | 20 |
| 0.55 | 20% | 100% | 31 |
| 0.6 | 15% | 100% | 33 |
| 0.65 | 10% | 100% | 35 |
| 0.7 | 10% | 100% | 35 |

## Abstention and cost

| mode | abstention precision | abstention recall | real calls / item | cached / item | prompt tokens / item | latency p50 | latency p95 |
|---|---|---|---|---|---|---|---|
| engram | 100% | 100% | 0.0 | 29.9 | 0 | 172 ms | 331 ms |

Latency includes cache hits, so it understates cold runs. Real calls and tokens count only what this run sent to the network.

## Engram store health

- Ad-hoc predicate rate: 0% of current facts (SPEC §18 threshold ~15%).
- Duplicate-entity rate: 2% of entities share a name with another.
- Adjudication rate: 0% of fact revisions were decided by the LLM adjudicator rather than the rules.

## System model reliability

Counted over the last invocation, cache replays included, so replaying a run from cache recounts it exactly.

- Structured calls: 514.
- Needed a repair round: 48 (9%); failed after it: 10 (2%). A failed session pack is re-extracted turn by turn; a failed turn adds no facts.
- Replies cut off by the output cap: 0; output tokens: 303508.
- Texts truncated before embedding: 0.

## Misses

- `dev-008` engram (knowledge_update): Which city do I live in now? — expected *Denver*, got "You live in Melbourne." (expected value missing)
- `dev-014` engram (knowledge_update): Which city do I live in now? — expected *Melbourne*, got "You live in Edinburgh." (expected value missing)
- `dev-017` engram (knowledge_update): Which city do I live in now? — expected *Valencia*, got "You live in Osaka." (expected value missing)
- `dev-019` engram (temporal_reasoning): When did I move to Valencia? — expected *April 2024*, got "You moved to Valencia in April." (Answer omitted the year 2024, providing only the month)
- `dev-033` engram (knowledge_update): Which city do I live in now? — expected *Berlin*, got "You live in Marseille." (expected value missing)
