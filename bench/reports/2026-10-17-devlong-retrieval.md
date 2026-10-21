# Engram-Bench — dev-long split, run 2026-10-17-devlong-retrieval

2026-10-17 · system model `gemini-3.5-flash-lite + gemini-embedding-2 embeddings` · judge `openai/gpt-oss-120b` · 40 items

## Accuracy by category

| category | n | engram |
|---|---|---|
| cross_session_recall | 12 | 0% |
| knowledge_update | 8 | 0% |
| temporal_reasoning | 6 | 0% |
| single_session_recall | 6 | 0% |
| multi_hop | 4 | 0% |
| abstention | 4 | 100% |
| **all** | 40 | **10%** |

## Retrieval recall@8

Share of answerable items where a retrieved memory contains the expected answer (automatic labels; a paraphrased answer counts as a miss).

| mode | recall@8 | n |
|---|---|---|
| engram | 97% | 36 |

## Ranker comparison (retrieval only, no answers composed)

| ranker | recall@8 |
|---|---|
| rrf | 97% (35/36) |
| linear | 97% (35/36) |

## Abstention and cost

| mode | abstention precision | abstention recall | real calls / item | cached / item | prompt tokens / item | latency p50 | latency p95 |
|---|---|---|---|---|---|---|---|
| engram | 10% | 100% | 9.4 | 67.7 | 4446 | 211 ms | 119718 ms |

Latency includes cache hits, so it understates cold runs. Real calls and tokens count only what this run sent to the network.

## Engram store health

- Ad-hoc predicate rate: 0% of current facts (SPEC §18 threshold ~15%).
- Duplicate-entity rate: 0% of entities share a name with another.

## Misses

- `dev-001` engram (cross_session_recall): What's my dog called? — expected *Ziggy*, got "(retrieval only)" (abstained on an answerable question)
- `dev-002` engram (cross_session_recall): Remind me, what am I allergic to? — expected *pollen*, got "(retrieval only)" (abstained on an answerable question)
- `dev-003` engram (knowledge_update): Where do I work these days? — expected *Stark Analytics*, got "(retrieval only)" (abstained on an answerable question)
- `dev-004` engram (multi_hop): Which city does my sister live in? — expected *Nairobi*, got "(retrieval only)" (abstained on an answerable question)
- `dev-005` engram (single_session_recall): What do I do for work? — expected *teacher*, got "(retrieval only)" (abstained on an answerable question)
- `dev-007` engram (cross_session_recall): Which instrument do I play? — expected *drums*, got "(retrieval only)" (abstained on an answerable question)
- `dev-008` engram (knowledge_update): Which city do I live in now? — expected *Denver*, got "(retrieval only)" (abstained on an answerable question)
- `dev-009` engram (single_session_recall): What do I do for work? — expected *architect*, got "(retrieval only)" (abstained on an answerable question)
- `dev-010` engram (temporal_reasoning): Where was I living in March 2024? — expected *Melbourne*, got "(retrieval only)" (abstained on an answerable question)
- `dev-012` engram (cross_session_recall): Remind me, what am I allergic to? — expected *penicillin*, got "(retrieval only)" (abstained on an answerable question)
- `dev-013` engram (cross_session_recall): What's my favourite food? — expected *tacos*, got "(retrieval only)" (abstained on an answerable question)
- `dev-014` engram (knowledge_update): Which city do I live in now? — expected *Melbourne*, got "(retrieval only)" (abstained on an answerable question)
- `dev-015` engram (temporal_reasoning): Which city was I living in during 2015? — expected *Berlin*, got "(retrieval only)" (abstained on an answerable question)
- `dev-016` engram (cross_session_recall): Which instrument do I play? — expected *drums*, got "(retrieval only)" (abstained on an answerable question)
- `dev-017` engram (knowledge_update): Which city do I live in now? — expected *Valencia*, got "(retrieval only)" (abstained on an answerable question)
- `dev-018` engram (multi_hop): Which city does my sister live in? — expected *Porto*, got "(retrieval only)" (abstained on an answerable question)
- `dev-019` engram (temporal_reasoning): When did I move to Valencia? — expected *April 2024*, got "(retrieval only)" (abstained on an answerable question)
- `dev-020` engram (temporal_reasoning): Where did I live before Osaka? — expected *Melbourne*, got "(retrieval only)" (abstained on an answerable question)
- `dev-022` engram (cross_session_recall): What's my parrot called? — expected *Olive*, got "(retrieval only)" (abstained on an answerable question)
- `dev-023` engram (cross_session_recall): Which instrument do I play? — expected *drums*, got "(retrieval only)" (abstained on an answerable question)
- `dev-024` engram (knowledge_update): Where do I work these days? — expected *Initech*, got "(retrieval only)" (abstained on an answerable question)
- `dev-025` engram (single_session_recall): What's my pet's name? — expected *Olive*, got "(retrieval only)" (abstained on an answerable question)
- `dev-026` engram (cross_session_recall): Which instrument do I play? — expected *violin*, got "(retrieval only)" (abstained on an answerable question)
- `dev-027` engram (cross_session_recall): What's my dog called? — expected *Mochi*, got "(retrieval only)" (abstained on an answerable question)
- `dev-028` engram (knowledge_update): Where do I work these days? — expected *Initech*, got "(retrieval only)" (abstained on an answerable question)
- `dev-029` engram (multi_hop): Which city does my sister live in? — expected *Denver*, got "(retrieval only)" (abstained on an answerable question)
- `dev-030` engram (single_session_recall): Which city do I live in? — expected *Krakow*, got "(retrieval only)" (abstained on an answerable question)
- `dev-032` engram (cross_session_recall): Remind me, what am I allergic to? — expected *shellfish*, got "(retrieval only)" (abstained on an answerable question)
- `dev-033` engram (knowledge_update): Which city do I live in now? — expected *Berlin*, got "(retrieval only)" (abstained on an answerable question)
- `dev-034` engram (single_session_recall): What's my pet's name? — expected *Nori*, got "(retrieval only)" (abstained on an answerable question)
- `dev-035` engram (temporal_reasoning): Going only on what I'd told you by 16 May 2024, which city did you think I lived in then? — expected *Marseille*, got "(retrieval only)" (abstained on an answerable question)
- `dev-036` engram (cross_session_recall): What's my favourite food? — expected *pho*, got "(retrieval only)" (abstained on an answerable question)
- `dev-037` engram (knowledge_update): Which city do I live in now? — expected *Seoul*, got "(retrieval only)" (abstained on an answerable question)
- `dev-038` engram (multi_hop): Which city does my sister live in? — expected *Lisbon*, got "(retrieval only)" (abstained on an answerable question)
- `dev-039` engram (single_session_recall): What's my pet's name? — expected *Rocket*, got "(retrieval only)" (abstained on an answerable question)
- `dev-040` engram (temporal_reasoning): Going only on what I'd told you by 14 May 2024, which city did you think I lived in then? — expected *Berlin*, got "(retrieval only)" (abstained on an answerable question)
