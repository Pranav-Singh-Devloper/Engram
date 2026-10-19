# P08b — Local mode: Engram's own processing, offline on a free 9B model

**Status:** in progress (approved 2026-10-18, revision 2 after review)

## Goal
Let Engram run its own processing with **no API key and no third-party call**, and measure it honestly on dev-long. Its own processing means extraction, adjudication, disambiguation, consolidation, composition and embeddings. Generation runs on qwen3.5:9b through Ollama, and embeddings on embeddinggemma.

This is a second *configuration* of one engine, not a fork. Gemini stays the default and the hosted demo's engine.

### What local mode does and doesn't guarantee
Local mode guarantees that **Engram never sends memory content to a third party**.
- **What it doesn't cover:** behind a cloud agent (Claude Code, Cursor), whatever `engram_recall` returns enters that agent's context and goes to that agent's model provider.
- **The only fully local setup** is local mode plus a local agent model.
- **The README and `docs/local.md` use exactly this wording.** No "your memories never leave your machine" without the qualifier.

## Why this scope (trimmed after review)
P09 (web) and P10 (ship) are what reviewers see. This phase keeps the parts with most of the resume value, about half the work of the first draft:
- one provider factory;
- local embeddings with enforced embedding spaces;
- setup and doctor scripts;
- one dev-long report with an ablation that explains the quality gap.

Everything else from the first draft is deferred to a named later phase in the ledger (see [Deferred](#deferred-to-p11)), not dropped. The run costs **0 Gemini calls** and happens on the laptop while P08 waits for quota resets.

## Spec refs
§1 (goals), §6.1–6.2 (write and read paths), §7 (resolution thresholds), §10 (MCP stdio), §13 (honest reporting; tune on dev only), §14 (providers and free stack), §17 (README).

## Depends on / unlocks
- **Depends on:** P08's `PromptedProvider` and `OllamaProvider`, session extraction, `--system=ollama`, and the frozen dev and dev-long splits; P07's stdio server and `processPending`.
- **Unlocks:** a "local mode" quickstart variant and a dev-long "Local" row for the README (P10); the deferred P11 work.

## Research (2026-10-18)

### Measured on this machine (Apple M3 Pro, 18 GB, Ollama 0.40.5, qwen3.5:9b digest `d63f830f28d515fe`)
Measured over 689 qwen calls already in the bench cache:

| | rate |
|---|---|
| Prompt read-in | ~491 tokens/s |
| Generation | **~28.7 tokens/s** |
| Extraction call | 8–14 s; output-bound, at ~400 output tokens a fact in our current format |

### Constrained JSON is unavailable for qwen3.5 on every Ollama route
`/api/chat` with `format` (schema or `"json"`), the OpenAI-compatible `/v1/chat/completions` with `response_format` (`json_schema` and `json_object`), and raw `/api/generate` with a hand-written template all return **"structured output is unavailable"**. This is a capability block in this Ollama version, related to the thinking-template bug [ollama#14645](https://github.com/ollama/ollama/issues/14645).

Consequences:
- An OpenAI-compatible provider *aimed at Ollama* gains nothing for this model.
- **llama.cpp's server** enforces JSON schemas with grammar-constrained decoding. It is the one real alternative, and it gets a timed spike (task 1).
- Until then, P08's fallback stands: the JSON schema goes in the system prompt, and zod plus one repair validate every reply.

### Sampling: the defaults fight JSON, but the obvious fix risks loops
- **The defaults:** qwen3.5:9b ships `presence_penalty 1.5`, `temperature 1` and `top_p 0.95`. A presence penalty punishes reused tokens, and JSON reuses keys constantly. That is a likely cause of the off-schema replies seen in P08 (`turns` missing).
- **The catch:** the [model card](https://huggingface.co/Qwen/Qwen3.5-9B) says presence_penalty is there "to reduce endless repetitions". Setting it to 0 *and* decoding greedily is exactly the mix that loops.
- **So this is measured, not assumed** (decision 5). Every structured call also gets a hard output cap.
- **Seeds:** a fixed seed does nothing under greedy decoding, so runs are reported as *not* bit-reproducible, and the cache is what makes reruns repeatable.

### Local embedding models (must fit `vector(768)`)
| model | dims | size | input limit | licence | prefixes | MTEB |
|---|---|---|---|---|---|---|
| **embeddinggemma:300m** (pick) | 768 (MRL 512/256/128) | 622 MB | **2K tokens** | Gemma terms | the same as gemini-embedding-2 | en 69.67 ([card](https://huggingface.co/google/embeddinggemma-300m)) |
| nomic-embed-text v1.5 | 768 | 274 MB | 8K | Apache-2.0 | `search_query:` / `search_document:` | 62.28 ([card](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5)) |

The prefixes match Gemini's, but **the length cap does not**. Our 24k-character cap is ~6k tokens, three times embeddinggemma's 2K limit. With Ollama's default `truncate`, a long turn would be cut silently, and a fact near its end could no longer be found by vector search. Decision 3 handles it.

Ollama exposes each model's **digest** in `/api/tags` (`embeddinggemma:300m`'s is recorded at pull time). A tag like `:300m` can point to new weights after an update, so a namespace's embedding space is identified by name *and digest*.

## Scope
**In:**
1. **A llama.cpp spike** (timed, ≤ 1 h of work plus a ~6 GB model file).
2. **`providerFromEnv` for every entry point, plus an automated no-egress test.**
3. **`OllamaEmbedder`** with a local length cap and a truncation counter.
4. **Embedding spaces:** name plus digest, backfilled, enforced, with `db:reembed`.
5. **Threshold profiles,** calibrated from a labelled pair set that no embedder influences.
6. **Measured sampling settings** plus an output cap on every structured call.
7. **The local MCP experience:** `wait: false`, plus a "still processing" notice on recall.
8. **`local:setup` and `local:doctor`.**
9. **A dev-long report with the ablation.**
10. **`docs/local.md`,** with the exact privacy wording and the offline proof.

**Out:** see [Deferred](#deferred-to-p11).

## Design decisions
1. **llama.cpp spike first.** Install llama.cpp (Homebrew) and the matching qwen3.5:9b GGUF, then run its server with `json_schema` on the 10 golden fixture conversations, both extraction prompts. Measure:
   - off-schema rate;
   - output tokens and wall time;
   - candidate counts against the prompt-schema fallback on Ollama, with the same model and quantization where possible.

   **Decision rule:** grammar-constrained decoding becomes the default local transport if it cuts off-schema replies to 0 at comparable speed, and an `OpenAICompatibleProvider` serves llama.cpp, LM Studio, vLLM and Ollama alike. Otherwise Ollama plus the prompt schema stays, and the spike's numbers are recorded either way (ADR-016).
2. **One factory, and a test that catches egress.**
   - **`providerFromEnv(env)`:** `ENGRAM_PROVIDER=gemini` (default) or `ollama` (or `openai-compat` if the spike wins), plus `OLLAMA_MODEL`, `OLLAMA_EMBED_MODEL` and `OLLAMA_BASE_URL`. It replaces the four hand-built `GeminiProvider` constructions in MCP stdio, jobs, fixtures and the bench; local mode never reads a Gemini key.
   - **The no-egress guard:** Node's built-in `fetch` ignores `HTTP(S)_PROXY`, so proxy variables prove nothing. An automated test installs a fetch wrapper that **fails on any non-loopback URL**, then drives remember → process → recall → consolidate → MCP stats in local mode. That test is the guarantee.
   - **The manual proof** (Wi-Fi off) is the recorded demo, not the evidence.
   - **The base URL** must be loopback unless `OLLAMA_ALLOW_REMOTE=1`, because Ollama has no auth.
3. **Local embeddings: cap and count, don't chunk.** `OllamaEmbedder` calls `/api/embed` in batches.
   - **Text:** Gemini's prefixes and L2 normalization, with the 768-d size asserted.
   - **Cap:** **~7k characters** for embeddinggemma, a per-embedder setting inside its 2K tokens with room for the prefix.
   - **Counting:** every capped text increments a counter that the bench reports as a **truncation rate**, alongside Gemini's at its 24k cap.
   - **Chunking** long episodes into several embeddings is the real fix for long turns. It changes recall's episode model, so it's deferred (P11) with the dev-long truncation rate as its evidence: dev-long turns are short, so the rate should be ~0 here and only LongMemEval needs chunking.
4. **The embedding space is explicit and versioned.**
   - **Migration 0007** adds `namespaces.embedding_model text not null` and **backfills** existing rows with `gemini-embedding-2`, so no null means "Gemini".
   - **Identity:** for Ollama embedders the value is `name@digest`.
   - **Enforcement:** ingest, recall, entity resolution and consolidation compare the namespace's space with the configured embedder's and refuse with a clear message on a mismatch.
   - **`pnpm db:reembed --namespace=<slug>`** re-embeds episodes, facts and entity labels in one transaction and updates the column.
5. **Sampling is a measured choice, with a cap.** On the 10 fixture conversations, run locally, compare presence_penalty {0, 0.5, 1.5} at temperature 0 for:
   - the off-schema rate (zod plus repair failures);
   - runaway outputs (hitting the cap);
   - output tokens.

   The best is set for structured calls only, and filler verbalization keeps creative settings.
   - **Cap:** every structured call gets `num_predict` of 2× that method's 95th-percentile output (measured), and replies that hit it are counted.
   - **No seed claims:** greedy decoding is not a determinism guarantee; reruns repeat through the cache.
6. **Thresholds per embedding model, calibrated from labelled pairs.** The six similarity cut-offs move into `config.embeddingProfiles[model]`: recall floor, entity match, description conflict, merge, entity search and drift.
   - **Pair set:** 100–200 pairs built **once, from the dev personas' code-defined ground truth, never test**:
     - same entity vs different entity names and labels;
     - paraphrased vs distinct fact statements;
     - related vs unrelated query–label pairs;
     - consecutive same-session vs cross-session turns.
   - **Labels:** they come from the generator's ground truth, so no embedder influences them.
   - **`pnpm calibrate --embedder=…`** embeds the pairs and picks each threshold at a stated error rate (for example ≤ 1% false merges). It writes the profile and a small report. Gemini's current values are checked against the same pairs first; if they disagree with what P03–P07 tuned, that is a finding, recorded and not silently changed.
   - **ADR-017** cites the error rates, and adding nomic later is a single rerun.
   - **Abstention floor:** the ~20 dev abstention items are too few to tune it alone, so it's reported as a range.
7. **The local MCP experience.**
   - **`wait: false`:** in local mode, `engram_remember` defaults to it (extraction is 5–15 s a turn) and the tool description says so.
   - **Recall:** `engram_recall` adds a line, and a structured `pending` count, when episodes are still processing ("2 recent memories are still being processed; ask again shortly"), so an agent that recalls straight after remembering knows why it found nothing.
   - **Exits mid-queue:** `docs/local.md` explains that work resumes on the next start (`processPending`, P07), so memories can lag behind the session that created them.
   - **Latency:** recall latency is measured while extraction runs, since both share the GPU.
8. **The bench measures local mode as its own system, with an ablation.** Dev-long runs in four configurations, then a fifth after decision 1:

   | row | generation | embeddings | thresholds | output |
   |---|---|---|---|---|
   | A (exists) | Gemini flash-lite | Gemini | Gemini | full |
   | B | qwen3.5:9b | Gemini | Gemini | full |
   | C | qwen3.5:9b | embeddinggemma | calibrated | full |
   | D (if the spike wins) | qwen3.5:9b via llama.cpp | embeddinggemma | calibrated | full |

   - **A vs B** isolates the generation model; **B vs C**, the embeddings and thresholds together. B costs Gemini *embedding* calls only, mostly cached.
   - Every row reports accuracy, recall@8, store health, truncation rate, off-schema and capped counts, and timings.
   - The judge stays Groq gpt-oss-120b, the same evaluator as the Gemini rows. Reports carry the model digests and the Ollama version.
9. **Setup and doctor.**
   - **`pnpm local:setup`** checks Ollama (installed, reachable, version), states the download sizes and pulls the models, and checks disk and RAM. It runs one extraction and one embedding as a smoke test, records the digests, and prints the `.env` lines.
   - **`pnpm local:doctor`** re-checks all of it and explains each failure: server down, model missing, the 501 block, the wrong dimension, too little memory, a digest changed since the namespace was created.

## Deliverables
```
packages/core/src/providers/factory.ts             # providerFromEnv (+ openai-compat if the spike wins)
packages/core/src/providers/ollamaEmbed.ts         # OllamaEmbedder: batch, cap, counter, digest
packages/core/src/config/index.ts                  # embeddingProfiles, per-method output caps
sql/migrations/0007_embedding_model.sql            # namespaces.embedding_model, backfilled
packages/core/src/db/namespaces.ts                 # space check
packages/core/src/egress.int.test.ts               # the no-egress guard
packages/mcp/src/tools.ts                          # local wait default, pending notice
bench/calibration/{pairs.ts,calibrate.ts}          # labelled pair set (dev personas) + calibration
scripts/{reembed,local-setup,local-doctor}.ts
bench/reports/2026-10-xx-devlong-local-{B,C,D}.md|json
docs/local.md
DECISIONS.md                                       # ADR-016 local transport and sampling; ADR-017 embedding spaces and profiles
```

## Tasks
1. **llama.cpp spike** (decision 1): install, run the 10 fixtures through both transports, record the numbers, decide the transport (ADR-016 draft).
2. **Factory and no-egress guard:** `providerFromEnv`, entry points switched, the guard test (decision 2).
3. **Local embeddings:** `OllamaEmbedder` with batching, the cap and the counter (decision 3).
4. **Embedding spaces:** migration 0007 with backfill, the space check, `db:reembed` (decision 4).
5. **Sampling and caps:** the measured presence-penalty comparison and the per-method `num_predict` (decision 5).
6. **Calibration:** the pair set from dev personas, `pnpm calibrate`, Gemini's values checked, embeddinggemma's profile and ADR-017 (decision 6).
7. **The MCP local experience:** the `wait` default, the pending notice, recall latency under load (decision 7).
8. **Setup and doctor** (decision 9).
9. **Bench:** dev-long rows B, C (and D), the comparison table, `docs/local.md` with the offline proof, the SPEC §1/§14/§17 wording, and ledger rows for the deferred work.

## Tests
- **Factory:** each provider value builds the right thing; local mode reads no Gemini key; an unknown provider is refused; a non-loopback Ollama URL is refused without the opt-in.
- **No egress:** with the fetch guard installed and local mode on, remember → process → recall → consolidate → stats make no non-loopback request. A deliberately remote call makes the test fail (mutation-checked).
- **Embedder:**
  - one call batches N texts;
  - prefixes are applied, and the cap is applied *and counted*;
  - a non-768 vector is an error;
  - vectors come back normalized;
  - the digest is read from `/api/tags`.
- **Spaces:**
  - the 0007 backfill sets `gemini-embedding-2` on existing rows;
  - a different embedder or digest is refused on ingest, recall and consolidation;
  - `db:reembed` switches a namespace, recall works after it, and re-running is a no-op.
- **Profiles and calibration:**
  - thresholds come from the embedder's profile;
  - an unknown embedder fails at startup;
  - calibration on a hand-made pair table picks the threshold at the stated error rate;
  - the pair set is built only from dev personas (a source-scan test, like the dataset/registry guard).
- **Sampling:** every structured call carries `num_predict`; a capped reply is counted and surfaces as an output error, not a hang.
- **MCP:** in local mode `wait` defaults to false, and recall reports pending episodes.

## Definition of done
- [x] The llama.cpp spike ran, its numbers are recorded, and the local transport is chosen by the stated rule (ADR-016).
- [x] `ENGRAM_PROVIDER` selects the provider for MCP stdio, jobs, fixtures and the bench; the automated no-egress test passes and is mutation-checked; the manual offline demo is recorded in `docs/local.md`. _The offline run used a macOS `sandbox-exec` profile that refuses every non-localhost connection (9/10; Gemini under the same profile fails)._
- [x] embeddinggemma runs locally with a ~7k-character cap, and the truncation rate is reported.
- [x] Embedding spaces are recorded as name@digest, backfilled (no null meaning), enforced, and converted by `db:reembed`.
- [x] Sampling for structured calls is chosen from measurements; every structured call is capped and capped replies are counted.
- [x] Threshold profiles are calibrated from the labelled dev pair set by a rerunnable script; Gemini's values are checked on the same pairs (ADR-017). _Gemini checked 2026-10-19; its values stay._
- [x] In local mode `engram_remember` defaults to `wait: false`, and recall reports pending work.
- [x] `pnpm local:setup` and `pnpm local:doctor` work from a fresh checkout.
- [x] A dev-long report has the ablation rows (A vs B vs C, plus D if adopted) with accuracy, recall@8, store health, truncation, off-schema and capped counts, and timings. _A 100%, B 93%, C 88% (C′ 95% with ledger row 43); D not adopted (ADR-016). Comparison in `docs/local.md`._
- [x] `docs/local.md` and SPEC §1/§14/§17 use the precise privacy wording; every deferred item is a ledger row targeting P11.

## Planned commits
1. `docs(phases): plan local mode`
2. `docs(decisions): record the local transport spike` (ADR-016)
3. `feat(core): build providers from the environment`
4. `test(core): prove local mode makes no outside calls`
5. `feat(core): embed locally through ollama`
6. `feat(db): record each namespace's embedding space`
7. `feat(core): measured sampling and output caps for local models`
8. `feat(bench): calibrate similarity thresholds from labelled pairs` (ADR-017)
9. `feat(mcp): tell agents when memories are still processing`
10. `feat(scripts): local setup and doctor`
11. `feat(bench): measure local mode on dev-long`

## Resource budget
| resource | use |
|---|---|
| Gemini generation | **0 calls** |
| Gemini embeddings | row B only, mostly cached from P08 |
| Groq judge | ~1 llm-judged item per dev-long row |
| Disk | embeddinggemma 0.6 GB; spike: llama.cpp plus a ~6 GB GGUF (14 GB free; removed after the spike if it loses) |
| Laptop time | spike ~1 h; sampling comparison ~30 min; calibration ~10 min; dev-long rows B and C ~1–1.5 h each (D ~1 h) |

## Deferred to P11
Each becomes a ledger row targeting P11, "Local mode, extended (after ship)", when this phase is approved:
- **A compact output format** for local models (~3× fewer output tokens). Its format ablation (qwen full vs compact), and the question of whether Gemini should adopt it too, to avoid two wire formats for good. ADR-016 records the question now.
- **Chunked embeddings** for turns over the embedder's limit, justified by the truncation rate (needed for LongMemEval, not dev-long).
- **Local golden fixtures** under `fixtures/expected-local/`, with a README saying they're **behavioral snapshots, not ground truth** (they include qwen's mistakes), and CI replay.
- **A test-split local run** (all modes, overnight), and a 10-item LongMemEval local smoke run.
- **A qwen3.5:4b "light" profile** for 8–16 GB machines, after its speed and quality are measured.
- **An `OpenAICompatibleProvider`** for other runtimes, if the spike didn't already bring it in.

## Risks and verify-at-build-time
- **The quality gap.** Report it, explained by the ablation, and claim "Engram's processing works offline", not parity with Gemini.
- **Ollama and model drift.** Digests in the reports and in namespace spaces, plus the Ollama version, make drift visible; `local:doctor` flags a changed digest.
- **The spike's comparison** must use the same model and quantization on both transports (NVFP4 on Ollama vs a GGUF quant on llama.cpp may differ). Note any difference.
- **GPU contention.** Recall latency is measured during extraction (decision 7).
- **Thermal throttling** on long runs: report throughput over time, plugged in.
- **Platforms:** the timings in the docs are for Apple Silicon only; CPU-only machines are far slower, and the docs say so.
- **Licences:** embeddinggemma is under the Gemma terms, so the docs name nomic-embed-text (Apache-2.0) as the alternative. qwen3.5 is Apache-2.0.
