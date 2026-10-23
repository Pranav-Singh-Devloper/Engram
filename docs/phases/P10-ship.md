# P10 — Ship

**Status:** planned (2026-10-23), awaiting approval. Expanded from the outline at phase start, using what P08–P09c learned.

## Goal
Make Engram easy for a reviewer to try, and true to what it claims. Concretely:
- deploy the hosted demo on free tiers, with a read-only showcase anyone can open;
- write the README and `docs/architecture.md`;
- close every ledger row aimed at P10.

The phase is done when three reviewer paths work from a fresh clone, step by step against the README:
1. the hosted demo;
2. `pnpm demo:offline`, with Docker only;
3. the quickstart with a free Gemini key.

## Spec refs
- §15 P10: the three reviewer paths.
- §17: README requirements.
- §14: free stack, data terms, keep-alive notes.
- §3: `db:migrate:hosted`.
- §11: the showcase namespace, read-only.
- §16: final identity checks.
- Appendix C: prior art.

## Depends on / unlocks
- **Depends on:** P08 (bench tables), P09b (demo pages), P09c (`/architecture`, linked from the README).
- **Unlocks:** P11 (local mode, extended), and anything after it that needs a live demo.

## What P10 inherits (ledger rows)
| row | item | plan |
|---|---|---|
| 13 | multi-instance deploys need synced clocks | README limitation (task 9) |
| 15 | nickname duplicates ("Rob" / "Robert") | README limitation (task 9) |
| 25 | the nightly job on the hosted DB | **already running**: `nightly.yml` has succeeded on Neon every day since 2026-10-18, and its log shows the decay sweep, demo cleanup and consolidation lines (all zero, since Neon holds no data yet). After the showcase seed, one dispatched run with real work closes it (task 7) |
| 29 | re-enabling paused workflows; Neon's monthly limits | README operations section (task 9) |
| 31 | `/graph` page (P09b stretch) | **proposed: close as won't-do** (decision 8) |
| 34 | Node ≥ 22.19 | `.node-version` to the current 22 LTS, and a CI fresh-clone job on it (task 5) |
| 44 | `bench --estimate` counts embedded texts | estimator fix, tests first (task 2) |
| 45 | production deploy via Git; the stray Production deployment; pending Neon migrations; a live chat smoke | task 6 |
| 46 | LongMemEval `engram_consolidated` | **needs Ollama**: decision 7 |
| 47 | embeddinggemma per-pair scores; galaxy local view | **needs Ollama**: decision 7 |
| 48 | explorer mount budget: one 51 ms task in 48 | idle-preload the heavy chunks, re-measure (task 3) |

## Decisions (for approval)
1. **Production deploy through Vercel's Git integration.** The existing project `engram` (root `apps/web`) gets connected to the GitHub repo, so pushes to `main` deploy production. *Rejected:* CLI deploys, which upload the working tree and once shipped an uncommitted file (P09a).
   - **The stray Production deployment** (`engram-lime.vercel.app`, no env, 500s) is superseded by the first Git deploy, which takes over the production domain. Deleting the old one is your call. I won't delete it.
2. **Production env vars, with you approving each value.** Today the project has 8 variables, all for Preview only, none for Production (checked 2026-10-23):
   - `DATABASE_URL`, Neon's direct endpoint, which is the name the web app reads (ADR-014 / ADR-019 #10). The scripts call the same URL `HOSTED_DATABASE_URL`;
   - `GEMINI_CHAT_MODEL` and `GEMINI_EMBED_MODEL`, as on Preview;
   - `ENGRAM_MCP_TOKENS`;
   - `ENGRAM_IP_HASH_SECRET` (a fresh 32-byte secret);
   - `ENGRAM_SHOWCASE_NAMESPACE=showcase`;
   - `ENGRAM_DEMO_DAILY_TURNS=120`;
   - Gemini keys **split by job**: production gets the main key plus one fallback, and the nightly workflow gets the other keys. A visitor spike then can't starve consolidation, or the reverse.
3. **The showcase is the `docs/demo.md` story, extracted by Gemini for real, then verified.** `pnpm seed:showcase [--hosted]` does three things:
   - tells the story as real turns in real sessions, through the live write path (about 10 generate calls and 30 embedded texts);
   - checks the engine's canonical answers against the story's expected ones (Berlin now, Paris back then, Initech retracted, Acme now);
   - refuses to finish if any of them is wrong, so the showcase can never quietly show a bad extraction.
   
   The namespace is kind `user`, not `demo`, so the nightly cleanup never deletes it, and anonymous reads of it are read-only (P09a). *Rejected:* scripted extraction, which is reproducible but would show facts no model extracted, on the page meant to prove the model path works.
4. **README bench tables are generated, not typed.** `pnpm docs:tables` writes the tables between markers in the README from the committed report summaries, and a drift test fails if the README is out of date. The same pattern as the explorer data, so the README can't disagree with `bench/reports/`.
5. **Diagrams in Mermaid**, which GitHub renders, in the README and `docs/architecture.md`, linking into the `/architecture` explorer for the interactive version. No new dependency.
6. **Hero gif from the hosted demo:** the §17 flow (remember → new session → recall → contradiction → timeline), recorded with the DevTools screencast and encoded with ffmpeg, which is already installed. It's kept under ~4 MB, and costs about 4 chat turns (12 generate calls).
7. **Rows 46 and 47 need Ollama**, which you paused on 2026-10-21. Two options:
   - **Recommended: resume Ollama for background jobs only, one at a time** (the memory rule). Row 47 is minutes of local embedding and no quota. Row 46 is about 4,458 Gemini calls over about two days, spread across the nightly-free keys. Both land in P10.
   - **Re-target both to P11**, with a note in the ledger and the README saying the LongMemEval consolidated number is pending.
8. **Row 31 (`/graph`) closes as won't-do.** The entity timelines, the ER diagram and the 3D galaxy cover what a graph page would show. It was a P09b stretch goal, and a page with no measured purpose isn't worth the bundle.
9. **The fresh-clone check runs twice:**
   - **locally**, in a temp directory, following the README literally and timed;
   - **in CI**, as a new `fresh-clone` job on the pinned Node, running install → migrate → `demo:offline`.
   
   Your machine has Node 22.14, below the pin. Installing another Node locally changes your system, so I'll ask first (decision 10). The CI job proves the pinned version either way.
10. **Local Node:** install the current 22 LTS with a version manager (fnm or nvm, your choice), or leave the local machine alone and let CI prove the pinned version. Recommended: leave it, and let CI prove it.

## Scope
**In:**
- the hosted deploy (Vercel Git production, Neon migrations, Data API check);
- the showcase seed;
- the nightly run on Neon;
- the README, `docs/architecture.md` and the hero gif;
- generated bench tables;
- the DECISIONS.md tidy;
- ledger rows 13, 15, 25, 29, 34, 44, 45 and 48 (plus 46 and 47 if decision 7 is approved);
- the fresh-clone checks;
- the §16 checks.

**Out:** P11's local-mode work (compact wire format, chunked embeddings, local goldens, test and LongMemEval local runs, a light profile); new features; `/graph` (decision 8).

## Deliverables
```
scripts/seed-showcase.ts (+ test on the local DB)      pnpm seed:showcase [--hosted]
scripts/docs-tables.ts (+ drift test)                  pnpm docs:tables
bench/runner/estimate.ts                               counts embedded texts (row 44)
apps/web: idle preload of the three.js / React Flow chunks (row 48)
.node-version, package.json engines                    current Node 22 LTS (row 34)
.github/workflows/ci.yml                               + fresh-clone job
README.md, docs/architecture.md, docs/hero.gif
DECISIONS.md                                           tidy, ADR-020 (deploy topology, showcase seeding)
```

## Tasks
1. **Verify free-tier limits** as of today (Neon, Vercel Hobby, Gemini, Groq, GitHub Actions) and record them here. They feed the README's operations section.
2. **Row 44:** `bench --estimate` counts unique embedded texts per mode, next to generate calls. Tests first.
3. **Row 48:** after load, preload the galaxy and storage chunks during idle time. Then rerun `scripts/explorer-perf.mjs` (3 runs) and record the result, whatever it shows.
4. **Showcase seed:** `seed:showcase`, tested on the local DB first (the canonical answers are asserted). ADR-020.
5. **Node and CI:** bump `.node-version` to the current 22 LTS, and add the `fresh-clone` job (Postgres service; install → migrate → `demo:offline`).
6. **Hosted deploy (with you):**
   - apply any pending migrations to Neon, and confirm its Data API is off;
   - connect Vercel to Git and set the production env (decisions 1 and 2), then deploy production from `main`;
   - seed the showcase on Neon;
   - smoke test: `/api/health`, a demo session, one live chat turn, `/api/mcp` with a token, and the landing page's showcase stats.
7. **Nightly on Neon:** the repo's Actions secrets (`HOSTED_DATABASE_URL`, `GEMINI_API_KEY`, `GEMINI_API_KEY_FALLBACK`) have been set since 2026-10-17. After the seed, dispatch `nightly` once and record a run that sweeps and consolidates real data (row 25). If decision 2's key split needs the nightly's fallback keys changed, you approve the new value first.
8. **Hero gif** (decision 6).
9. **README** per §17, plus the operations section and the limitations (rows 13, 15, 29, and local mode's measured gap); generated bench tables; `docs/architecture.md`; the DECISIONS.md tidy (mark ADR-012's use case gone; check every status line).
10. **Fresh-clone verification** of the three paths, timed and literal, with the README fixed wherever it's wrong. Then the CI job green.
11. **Close:** the §16 identity checks, ledger rows closed or explicitly re-targeted, the phase index updated.
    
    *Background, if decision 7 is approved:* row 47 (calibration scores, galaxy local embeddings, explorer data rebuilt), then row 46 (LongMemEval consolidated, with the report regenerated), one job at a time.

## Tests
- **Showcase seed:** on the local DB, after seeding, `factsAsOf` gives the story's expected answers. The seed fails if any is wrong, and a second run is idempotent (it refuses an existing showcase unless told `--replace`).
- **Docs tables:** the README's generated section equals what `docs:tables` would write (a drift test).
- **Estimator:** text counts match hand-computed examples for each mode, and repeated texts are counted once.
- **Explorer preload:** an idle preload never runs before load, and the chapters still render (page smoke test).
- **CI fresh-clone job:** the whole offline path on the pinned Node.

## Definition of done
- [ ] Neon has every migration applied (`db:migrate:hosted`), its Data API is off, and the deploy's `/api/health` says `engram`.
- [ ] Production on Vercel deploys from `main` through the Git integration, with the approved env. The stray Production deployment is superseded.
- [ ] The showcase namespace is seeded on Neon and verified, and anonymous visitors see it read-only.
- [ ] A `nightly.yml` run against Neon logs the decay sweep, the demo cleanup and consolidation (row 25).
- [ ] `/api/mcp` answers with a bearer token, and a live chat turn works on production.
- [ ] README per §17: hero gif; what and why; the three reviewer paths; architecture diagram; generated bench tables (wins and losses); MCP snippets; design notes; limitations (free-tier data terms, disambiguation, extraction error rates, dependence on clients calling remember, local mode's gap and privacy boundary, rows 13 and 15); prior art; operations (row 29, Neon's monthly limits).
- [ ] `docs/architecture.md` is written. DECISIONS.md is tidied (superseded ADRs marked, never deleted), and ADR-020 is added.
- [ ] All three reviewer paths are verified from a fresh clone against the README, and the quickstart takes under 10 minutes (timed).
- [ ] `.node-version` is the current 22 LTS (≥ 22.19), and the CI fresh-clone job passes on it (row 34).
- [ ] Rows 44 and 48 are closed with evidence. Rows 46 and 47 are closed, or re-targeted with your approval (decision 7).
- [ ] The final §16 checks are clean: one author identity, no attribution trailers.

## Planned commits
1. `docs(phases): expand the P10 ship plan`
2. `feat(bench): count embedded texts in the estimate`
3. `perf(web): preload the explorer's heavy chunks when idle`
4. `feat(scripts): seed and verify the showcase namespace`
5. `build: pin the current Node 22 LTS and check a fresh clone in CI`
6. `docs: add the README, architecture notes and hero gif` (and `feat(scripts): generate the README bench tables`)
7. `docs(decisions): tidy statuses and record the deploy topology (ADR-020)`
8. `docs(phases): close P10`

## Free-tier notes
| resource | P10 use (estimate) |
|---|---|
| Gemini generate | seed ~10, smoke ~3, gif ~12, quickstart check ~10: **~35 calls** (row 46 adds ~4,458 if approved, over ~2 days of the keys nightly doesn't use) |
| Gemini embed | seed ~30, smoke and gif ~40, quickstart ~30: **~100 texts** |
| Neon | migrations, the seed, smoke and a nightly run: minutes of compute against 100 CU-hours a month. Never bench or bulk tests (CLAUDE.md) |
| Vercel Hobby | one production deploy per push to `main`; functions well inside 300 s |
| GitHub Actions | CI plus the fresh-clone job (public repo: free) |
| Groq | none, unless row 46 is approved (its judging, ~98 calls) |

## Risks and verify-at-build-time
- **Free limits change.** Task 1 verifies them before the README states any.
- **The demo needs occasional attention:** Neon's monthly compute, the daily Gemini cap. The landing page must degrade to the read-only showcase, not an error page. That gets checked by turning the cap off for one request in a preview.
- **Port clash in the local fresh-clone check:** the fresh clone's Postgres also wants 54329. The dev database is stopped for the check and restarted after; your data is in a Docker volume, untouched.
- **Secrets:** they're only ever set through `gh secret set` and Vercel's env, with values you approve. They're never printed, logged or committed.
- **The hosted showcase seed spends real Gemini calls on the shared demo database.** It runs once, verifies itself, and refuses to overwrite without `--replace`.

## What I'll need from you
- Approval of decisions 1–10. Decisions 7 and 10 are real choices; the rest are recommendations.
- **Task 6:** confirm or connect the GitHub repo to the Vercel project (dashboard, or I run `vercel git connect` once you say so), and approve the production env values.
- **Task 7:** tell me which of your five keys the nightly's secrets should hold, if decision 2's split changes them. I can't read secret values, only replace them.
