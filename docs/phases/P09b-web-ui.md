# P09b — Web UI (and P09c — Architecture explorer)

**Status:** P09b in progress; P09c planned. Approved 2026-10-21 as written: two phases, a 3D galaxy (three.js), the dependencies listed.

This file plans two phases. **P09b** is the dashboard SPEC §12 requires. **P09c** is the architecture explorer the user asked for on 2026-10-21: an interactive, animated, deeply referenced tour of how Engram works and why. P09c depends on P09b's design system and data plumbing. They're split so each phase stays one reviewable unit (decision 1).

## Goal
- **P09b:** make memory visible. The pages:
  - a chat playground that shows cross-session recall and the memories each answer used;
  - an entity timeline where conflict resolution and record-time history can be *seen*;
  - a memory inspector, eval results and a landing page;
  - `docs/demo.md`, a script anyone can follow.
- **P09c:** `/architecture`, an in-depth explorer of every subsystem. Each one gets:
  - a diagram;
  - an interactive model you can drive;
  - the real numbers from this repo's reports;
  - the research it draws on, linked to the paper.

  It should leave a reader with more depth than they can take in at once, and every claim should be checkable.

## Spec refs
§12 (pages, design bar, data notice), §6.2–§6.3 (recall, `used_memory_ids`), §7 (versioned facts, `includeRevised`), §8 (consolidation), §9 (decay), §11 (the API P09a built), §13 (bench), §17 (README visuals), Appendix C (prior art).

## Depends on / unlocks
- **Depends on:** P09a (every page reads the real API) and P08 (the reports the eval and benchmark views plot).
- **Unlocks:** P10 (deploy, showcase seed, README hero gif from `/chat` and `/architecture`).

## Research (2026-10-21)
**Stack, versions checked on npm today:**
- Next 16.4 (webpack build, ADR-019), React 19.3.
- **Tailwind 4.3** (`@tailwindcss/postcss`) with **shadcn/ui 4.22** (copied-in components on `radix-ui`, `clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react`).
- **TanStack Query 5.104.**
- **Motion 14.4** (Framer Motion's successor, MIT).
- **d3 7.9** (ISC).
- **@xyflow/react 12.12** (MIT).
- **KaTeX 0.19** (MIT).
- **three 0.186 / @react-three/fiber 9.8 / drei 10.7** (MIT).
- **umap-js 1.4** (MIT).

**Rejected:**
- **GSAP:** free, but under a "standard no-charge" license, not an open-source one. Motion covers the same ground.
- **recharts / visx:** d3 with React gives one visual language and full control.
- **Lenis smooth-scroll:** scroll hijacking hurts accessibility.

**References, every one verified (arXiv ID, DOI or publisher page) before inclusion:**

| topic in Engram | reference |
|---|---|
| the benchmark, its five abilities, indexing/retrieval/reading stages | Wu et al., *LongMemEval*, ICLR 2025 — [arXiv:2410.10813](https://arxiv.org/abs/2410.10813) |
| very long conversational memory benchmarks | Maharana et al., *LoCoMo*, ACL 2024 — [arXiv:2402.17753](https://arxiv.org/abs/2402.17753) |
| tiered "OS-style" memory (prior art) | Packer et al., *MemGPT* — [arXiv:2310.08560](https://arxiv.org/abs/2310.08560) |
| memory stream; recency × importance × relevance retrieval; reflection | Park et al., *Generative Agents*, UIST 2023 — [arXiv:2304.03442](https://arxiv.org/abs/2304.03442) |
| forgetting-curve decay reinforced by recall (our retention score) | Zhong et al., *MemoryBank*, AAAI 2024 — [arXiv:2305.10250](https://arxiv.org/abs/2305.10250); Ebbinghaus, *Memory* (1885; tr. 1913) — [York University Classics](https://psychclassics.yorku.ca/Ebbinghaus/memorypref.htm) |
| extract-and-update memory layer (prior art) | Chhikara et al., *Mem0* — [arXiv:2504.19413](https://arxiv.org/abs/2504.19413) |
| bi-temporal knowledge graph, invalidating instead of deleting (closest prior art) | Rasmussen et al., *Zep* — [arXiv:2501.13956](https://arxiv.org/abs/2501.13956) |
| self-organizing linked notes | Xu et al., *A-MEM*, NeurIPS 2025 — [arXiv:2502.12110](https://arxiv.org/abs/2502.12110) |
| hippocampal-index retrieval over a KG | Gutiérrez et al., *HippoRAG* — [arXiv:2405.14831](https://arxiv.org/abs/2405.14831) |
| valid time vs transaction (record) time | Snodgrass & Ahn, *A Taxonomy of Time in Databases*, SIGMOD 1985 — [doi:10.1145/318898.318921](https://doi.org/10.1145/318898.318921) |
| episodic vs semantic memory (our two stores) | Tulving, *Episodic and Semantic Memory*, in *Organization of Memory*, Academic Press, 1972 |
| consolidation: fast episodic store → slow semantic store | McClelland, McNaughton & O'Reilly, *Complementary Learning Systems*, Psych. Review 1995 — [doi:10.1037/0033-295X.102.3.419](https://doi.org/10.1037/0033-295X.102.3.419) |
| rank fusion (our RRF ranker, k = 60) | Cormack, Clarke & Büttcher, SIGIR 2009 — [doi:10.1145/1571941.1572114](https://doi.org/10.1145/1571941.1572114) |
| retrieval-augmented generation (the rag baseline) | Lewis et al., NeurIPS 2020 — [arXiv:2005.11401](https://arxiv.org/abs/2005.11401) |
| why full_context degrades on long inputs | Liu et al., *Lost in the Middle*, TACL 2023 — [arXiv:2307.03172](https://arxiv.org/abs/2307.03172) |
| LLM-as-a-judge and its biases (our judge) | Zheng et al., *MT-Bench / Chatbot Arena* — [arXiv:2306.05685](https://arxiv.org/abs/2306.05685) |
| judge agreement statistic | Cohen, *A Coefficient of Agreement for Nominal Scales*, 1960 — [doi:10.1177/001316446002000104](https://doi.org/10.1177/001316446002000104) |
| vector index (pgvector HNSW) | Malkov & Yashunin, *HNSW* — [arXiv:1603.09320](https://arxiv.org/abs/1603.09320) |
| embedding models | Lee et al., *Gemini Embedding* — [arXiv:2503.07891](https://arxiv.org/abs/2503.07891); Schechter Vera et al., *EmbeddingGemma* — [arXiv:2509.20354](https://arxiv.org/abs/2509.20354) |
| 768-d truncated embeddings | Kusupati et al., *Matryoshka Representation Learning*, NeurIPS 2022 — [arXiv:2205.13147](https://arxiv.org/abs/2205.13147) |

Each citation states what Engram *took* from the work ("inspired by", "implements", "differs by"), never decoration.

## Decisions (for approval)
1. **Two phases, one file.** P09b ships the SPEC §12 dashboard; P09c ships `/architecture`. P09c starts only when P09b's DoD is met. *Rejected:* one mega-phase, which would be too large to review, and would leave the required pages waiting on the showpiece.
2. **Design system: dark-first, dense, one visual language.**
   - Tailwind 4 tokens with shadcn/ui primitives.
   - One chart grammar (d3 scales, React-rendered SVG), Inter for text, a mono face for data.
   - Light mode supported; works at phone width.
   - No lorem ipsum: every number and string comes from the API or the repo.
3. **Data at build time for the explorer.** P09c reads the repo's own artifacts when the app builds:
   - `bench/reports/*.json`;
   - `bench/calibration/*.json`;
   - `DECISIONS.md` (parsed into ADR cards);
   - the engine's `config`;
   - SPEC section anchors.

   The explorer can't drift from the code it describes, and it needs no database or model calls.
4. **The engine's own code drives the interactive models.** The decay, RRF, canonical-query and fusion demos import `packages/core` functions (`retentionScore`, the RRF fuser, the as-of filter) instead of reimplementing them. What you scrub on screen is what the engine computes. Tests assert this.
5. **Animation rules ("butter smooth").**
   - Animate only `transform` and `opacity`.
   - Long-lived scenes (particle flows, the embedding galaxy) run in `requestAnimationFrame` on canvas or WebGL, never in React state.
   - Sections load lazily, when they scroll into view.
   - `prefers-reduced-motion` swaps every animation for its end state.
   - The budget is 60 fps on an M3 Pro and no long tasks over 50 ms after load, checked in Chrome's performance panel at build time (task notes record the numbers).
6. **One 3D scene, lazy-loaded: the embedding galaxy.**
   - The data: real dev-split facts and episodes, projected to 3D with UMAP offline (`umap-js` in a script; the shipped JSON is small).
   - The scene: the points rendered with three.js, colored by entity and predicate, with hover to read the text.
   - three.js loads only on `/architecture` when that section is reached.

   *Alternative offered:* a 2D canvas version with no three.js, to save about 150 kB (gzip) on that route.
7. **Pages call P09a's API through TanStack Query.** Chat reads the server-sent event stream directly, with no AI SDK (ADR-019).
8. **Testing without new test frameworks.**
   - Vitest for every data-shaping function (timeline layout, bitemporal plane geometry, chart scales, ADR parsing, citation checker).
   - A render smoke test per page with React's server renderer.
   - Visual and interaction checks in Chrome (screenshots at phone and desktop widths, the performance trace for the fps budget), recorded in task notes.
   - *Rejected:* Playwright, a new dependency, for a phase whose behavior is mostly visual.

## Build notes (recorded as they happen)
- **Task 1: reduced motion must still animate to the end state.** Motion renders an element's `initial` state on the server (`opacity: 0`). Passing no animation props when the visitor prefers reduced motion therefore left the hero **invisible**. Every entrance now always animates, with `duration: 0` under reduced motion. That's the pattern for every animated component here.
- **Task 1: phone-width checks.** Headless Chrome won't size a window below 500 px; a 390 px screenshot was just a crop of a 500 px layout. True 390 px checks load the page inside a 390 px iframe. Static screenshots also force `prefers-reduced-motion`, which exercises that path at the same time.
- **Task 1:** Tailwind 4's `@tailwindcss/postcss` works under `next build --webpack` (the plan's verify item). The theme is class-based with an inline pre-paint script, so there's no flash and no `next-themes` dependency. `?theme=light|dark` overrides it for one visit, for screenshots.

- **Task 3: the first real browser run (local Ollama), driven over the DevTools protocol.** The Chrome extension wasn't connected; a ~40-line driver in the scratchpad used Node's built-in WebSocket. "I live in Lisbon and work at Acme…" in session 1, then "Where do I work?" in session 2, answered "You work at Acme." It used the stored turn while extraction was still running in the background: local qwen takes tens of seconds a turn, and the facts appeared about two minutes later. Two fixes came out of it:
  1. The assistant's "I don't know." reply was stored and then recalled as a memory. Chat now stores a reply only when memory supported it (SPEC §11).
  2. An unsupported reply to a *statement* read as a failure. The UI now says "no memory supported an answer · your message is stored". The composer prompt is shared with the bench, so it wasn't changed.

  Recall also now returns each fact's subject and object ids (e11ff3c), so a used memory links to its entity timeline.

- **Task 4: the entity timeline.**
  - **Parity:** its "believed at" and "true at" rules are tested equal to the engine's `factsAsOf` on the Paris → Berlin → correction → backfill story, over 20 (valid-at × known-at) pairs.
  - **In the browser:** at valid 30 Apr 2024 and known 1 May 2024 it answered "The user lives in Paris." That's correct: the March move was learned on 10 June.
  - **Design fixes from screenshots:** room on the axis for unknown starts (Marseille was a sliver); All / 5-year / 1-year zoom (Paris, Jan–Mar 2024, was a few pixels on a 12-year axis); a legend for the five encodings; a responsive label column; the "valid at" label flipping side near the edge.
  - **Screenshot method:** the 390 px iframe trick catches charts before their ResizeObserver re-measures. Mobile checks now use DevTools device emulation (`Emulation.setDeviceMetricsOverride`) through the same driver.

- **Task 7: walking `docs/demo.md` end to end in the browser found four things.**
  1. **The script's wording.** "I moved to Berlin in March" said minutes after "I live in Paris" dates Berlin *before* Paris. The engine then correctly records Berlin as older history and keeps Paris current. Same-day demos must state moves in the present ("I just moved to Berlin"). Local qwen even dated "just moved" to yesterday. On Gemini the full script passed: Paris → Berlin, Initech retracted → Acme, "You live in Berlin and work at Acme."
  2. **A real bug: stepped sliders.** The timeline's known-at slider stepped by hours from its range start, so its maximum snapped back before the move, and "known at now" still answered Paris. The sliders are now continuous (`step="any"`), and same-day ranges show the time of day.
  3. **A layout rule that was wrong for demos.** "Pad a short history to a year" squeezed a 20-minute demo against the axis's right edge. The axis now fits the data (10-minute floor) with hour, day or month ticks to match, and zoom shows only for histories over a year.
  4. **Memory pressure (18 GB).** qwen (10 GB) and embeddinggemma loaded for both the demo app and the LongMemEval run, alongside Docker, Chrome and Next, crashed Ollama's embedding runner and Chrome. Heavy local jobs run one at a time. At the user's request the demo was then walked on Gemini (five keys) instead of Ollama.

- **Task 8: the visual pass found a crash on reload.** `/chat` stores its transcripts as JSON, which turns memory dates into strings. Reloading the page after any conversation threw `e.getTime is not a function` inside a memory card. Next's error boundary showed "This page couldn't load", and an earlier test missed it because every run started from a fresh browser profile. Stored transcripts are now revived through the live stream's own zod schema, and anything malformed is dropped. A test covers the round trip. The first rebuild still looked broken: that was a stale `.next` directory. A clean build (`rm -rf .next`) fixed it, so surprising results get re-checked against a clean build.

## P09b — scope
**In:**
- `/` landing: what Engram is, live showcase stats, links.
- `/chat`:
  - demo session, a session switcher (create, rename; names in `localStorage`);
  - streaming events (memories, then the answer);
  - a used-memories side panel with provenance links to `/entities/[id]` and `/memories`;
  - the persistent "don't enter personal data" notice;
  - the 429 limit and cap messages.
- `/entities/[id]`:
  - validity bars per predicate on a time axis with sensible bounds for open and very old windows;
  - superseded, retracted and revised styling;
  - the revision chain;
  - the "show record-time history" toggle (`includeRevised`);
  - a known-at scrubber.
- `/memories`: search and tier, status and predicate filters, retention-score sort, and rows that expand to provenance. It reads only: `trackAccess` is false.
- `/evals`: per-category accuracy across all modes, test vs LongMemEval, recall@8, cost per item, judge agreement, run history.
- `docs/demo.md`, plus app shell, navigation and theme toggle.

**Out:** `/architecture` (P09c), the `/graph` stretch goal, the production deploy and showcase seed (P10).

## P09c — scope: `/architecture`
One long page of chapters, with a sticky table of contents and deep links (`/architecture#bitemporal`). Each chapter has four parts:
1. a diagram;
2. an interactive model;
3. real numbers;
4. "Inspired by / differs from" with linked references.

1. **System overview:** an animated flow from MCP, REST and chat through ingest, extract, resolve, store and recall to compose. Particles travel the write and read paths. Click a node to open its chapter.
2. **The write path, step by step:** "I moved to Berlin in March." is scrubbed through every stage:
   - the stored episode, then the embedding, then the zod-validated extraction JSON;
   - the time hint resolved against `occurred_at`;
   - the entity-resolution ladder: exact name, alias, embedding similarity, LLM disambiguation;
   - conflict resolution: the rule fast path vs the LLM adjudicator;
   - the versioned rows written.

   The real outputs come from the golden fixtures.
3. **Bitemporal plane:** valid time on one axis, record time on the other, with the Paris → Berlin → correction → backfill story as rectangles. Drag the `validAt` and `knownAt` crosshairs and the canonical query's answer updates live, run by the engine's own as-of logic. [Snodgrass & Ahn 1985]
4. **Fact versions (§7.2):**
   - an animated row chain: insert the new fact, write the closed copy, invalidate the old one, with `revises` and `superseded_by` pointers drawn;
   - why queries filter on time, never status;
   - the §7.4 suite's 14 cases as a clickable grid.
5. **Entity resolution and similarity profiles (ADR-017):**
   - positive and negative cosine distributions for Gemini and embeddinggemma, from the 537 calibration pairs;
   - drag a threshold and watch false merges and misses change.
6. **Recall:**
   - the four lists (fact vectors, episode vectors, full-text, entity expansion);
   - RRF with a draggable k [Cormack 2009] next to the linear ranker;
   - priors, the abstention floor and the floor simulation from dev-long;
   - how this differs from Generative Agents' recency × importance × relevance [Park 2023].
7. **Decay and forgetting (§9):**
   - the retention formula in KaTeX;
   - curves per tier with sliders for importance and access;
   - the archive threshold line, with static predicates exempt.
   - [Ebbinghaus 1885; MemoryBank 2023]
8. **Consolidation (§8):**
   - episodic to semantic [Tulving 1972; CLS 1995];
   - session turns clustered by drift, then summarized;
   - inserted vs merged (43 vs 3,077 on test);
   - the weak inferences, shown honestly.
9. **The embedding galaxy:** the 3D scene from decision 6, with a toggle between Gemini and embeddinggemma spaces. [Gemini Embedding; EmbeddingGemma; MRL]
10. **Storage:**
    - the `engram` schema as an interactive ER diagram (@xyflow/react);
    - indexes (HNSW [Malkov 2016], GIN full-text, partial current-belief);
    - advisory locks, transaction-scoped only;
    - Neon vs local Docker.
11. **Providers and local mode:**
    - Gemini vs Ollama;
    - the A/B/C/C′ ablation chart;
    - the transport spike (ADR-016);
    - the quota arithmetic (ADR-018: texts, not requests);
    - per-lane key rotation.
12. **Interfaces:**
    - MCP tools and REST endpoints;
    - an animated sequence diagram (remember → after-response extraction → recall);
    - the auth matrix;
    - the demo's limits as a flow (throttles, cap).
13. **Benchmarks:**
    - test vs LongMemEval per category;
    - accuracy vs prompt tokens per question;
    - the judge-agreement confusion matrix with κ [Cohen 1960; Zheng 2023];
    - why the test split saturates, and why full_context struggles on long inputs [Liu 2023; Wu 2024].
14. **Prior art:** Engram positioned against MemGPT, Generative Agents, MemoryBank, Mem0, Zep/Graphiti, A-MEM, HippoRAG and LoCoMo. Each gets a capability matrix row: what Engram adopted, what it does differently, and what it lacks.
15. **Decision log:** all ADRs (1–19, growing) as a filterable timeline, each card showing the context, the decision, the rejected alternatives and the evidence. This is the "defend every decision" chapter.
16. **References:** the numbered bibliography; every inline citation links here and out to the paper.

## Deliverables
```
apps/web/app/{page,layout}.tsx, globals.css (Tailwind 4 tokens)
apps/web/app/{chat,memories,evals}/page.tsx, apps/web/app/entities/[id]/page.tsx
apps/web/app/architecture/page.tsx + src/architecture/<chapter>/…      (P09c)
apps/web/src/components/ui/* (shadcn), src/components/charts/* (d3 + SVG)
apps/web/src/lib/{api,sse-client,timeline,bitemporal,citations}.ts + tests
apps/web/src/content/references.ts      (the verified bibliography; a test checks every inline cite resolves)
scripts/explorer-data.ts                (build-time: reports, calibration, ADRs, UMAP projection → JSON)
docs/demo.md
```

## Dependencies to approve
- **P09b:**
  - `tailwindcss` and `@tailwindcss/postcss`;
  - shadcn's `radix-ui`, `clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react` (the `shadcn` CLI runs via `pnpm dlx`, not installed);
  - `@tanstack/react-query`;
  - `motion`;
  - `d3` with `@types/d3`.
- **P09c:**
  - `@xyflow/react`;
  - `katex`;
  - `three`, `@react-three/fiber` and `@react-three/drei` (or none of these, with decision 6's 2D alternative);
  - `umap-js`, a dev dependency of `scripts` only.

All are MIT, ISC or Apache-2.0 and free, with nothing paid and no external service.

## Tasks
**P09b**
1. App shell: Tailwind 4, shadcn init, theme tokens, nav, theme toggle, layout at phone width.
2. API client (TanStack Query) and the SSE client; tests.
3. `/chat`: sessions, streaming, used-memories panel, notices, limit messages.
4. `/entities/[id]`: timeline layout (tests first), bars, styling, revision chain, record-time toggle, known-at scrubber.
5. `/memories`: table, filters, sort, expandable provenance.
6. `/evals`: charts from `/api/evals` plus cost and agreement.
7. `/` landing with live showcase stats, and `docs/demo.md` walked end to end locally (Ollama, so no Gemini quota).
8. Visual pass in Chrome at 390 px and 1440 px, light and dark; fix list; screenshots recorded.

**P09c**
1. `scripts/explorer-data.ts`: report, calibration and ADR extraction, plus the UMAP projection; tests.
2. Page frame: chapters, sticky table of contents, lazy loading, reduced-motion switch, the references system with its resolver test.
3. Chapters 1–4 (overview, write path, bitemporal plane, versions).
4. Chapters 5–8 (resolution, recall, decay, consolidation).
5. Chapter 9 (the galaxy) and chapter 10 (storage ER).
6. Chapters 11–13 (providers, interfaces, benchmarks).
7. Chapters 14–16 (prior art, decision log, references).
8. Performance pass: Chrome trace for each chapter against the decision 5 budget; record fps and long tasks.

## Tests
- **Timeline layout:**
  - open-ended windows clamp to the axis;
  - unknown starts render as unknown;
  - overlapping versions stack;
  - the record-time toggle adds the revised versions.
- **Bitemporal plane:** for each crosshair position, the rectangles marked "answer" equal what the engine's as-of query returns on the same story.
- **SSE client:** parses `memories`, `answer`, `done` and `error`; handles 429 JSON and a dropped stream.
- **Decay and RRF demos:** the plotted values equal `retentionScore` and the engine's RRF output for the same inputs.
- **Explorer data:**
  - the reports parse with `BenchSummary`;
  - every ADR in `DECISIONS.md` becomes a card with a title, date and status;
  - the UMAP JSON has one point per source row.
- **References:** every inline citation key resolves to an entry, and every entry has a verified URL or DOI (pattern-checked, not fetched in CI).
- **Pages:** a render smoke test of each page, with mocked fetches.

## Definition of done
**P09b**
- [ ] `/chat`: demo namespace, session switcher (create and rename), streaming events, used-memories panel with provenance links, persistent data notice, limit and cap messages.
- [ ] `/entities/[id]`: validity bars per predicate, superseded/retracted/revised styling, revision chain, record-time toggle, known-at scrubber.
- [ ] `/memories`: search, tier/status/predicate filters, retention sort, expandable provenance, no access tracking.
- [ ] `/evals`: per-category accuracy for every mode, test and LongMemEval, recall@8, cost per item, judge agreement, run history.
- [ ] `/`: landing with live showcase stats.
- [ ] `docs/demo.md` can be followed without improvising (remember in A, recall in B, contradict, watch the timeline).
- [ ] Dark and light, usable at 390 px, no lorem ipsum. Chrome screenshots are recorded.

**P09c**
- [ ] `/architecture` has all 16 chapters, each with a diagram, an interactive model, real repo numbers, and linked references.
- [ ] The interactive models call the engine's own functions (tests prove equality).
- [ ] Every reference is verified and resolvable (test). Each says what Engram took or does differently.
- [ ] Performance budget met (60 fps on an M3 Pro, no long task over 50 ms after load), and `prefers-reduced-motion` honored. Measurements recorded.
- [ ] The decision log shows every ADR in `DECISIONS.md`.

## Planned commits
- **P09b:**
  1. `docs(phases): plan the web ui and architecture explorer`
  2. `feat(web): app shell, theme and design tokens`
  3. `feat(web): api and event-stream clients`
  4. `feat(web): chat playground with used-memories panel`
  5. `feat(web): entity timeline with record-time history`
  6. `feat(web): memory inspector`
  7. `feat(web): eval dashboard`
  8. `feat(web): landing page and demo script`
- **P09c:**
  1. `feat(scripts): build explorer data from reports and decisions`
  2. `feat(web): architecture page frame and references`
  3. Then one commit per chapter group (four or five), and `perf(web): hold the explorer to its frame budget`.

## Free-tier notes
| resource | use |
|---|---|
| Gemini | **~0.** Pages are built against the local DB with **Ollama** (local mode) for the chat walk-through; FakeProvider in tests. The explorer reads committed artifacts. |
| Vercel Hobby | preview deploys only; three.js is code-split to `/architecture` so other routes stay light |
| Neon | none until P10 |

## Risks and verify-at-build-time
- **Scope:** P09c is large. If time runs short, chapters ship in order, with the decision log and references guaranteed. Partial chapters are never published with placeholder text.
- **Animation performance on weaker machines:** the reduced-motion path and a "lite" toggle (static diagrams) are the fallback. The galaxy caps its point count.
- **Next 16 and Tailwind 4 with webpack:** verify `@tailwindcss/postcss` under `next build --webpack` in task 1.
- **Citations:** a wrong link is worse than none. Every reference above was verified on 2026-10-21. New ones need the same check before they're added.
- **Showcase data** doesn't exist until P10. P09b designs against a local namespace seeded by `demo:offline --keep` and dev personas, never invented data.
