# P10 — Ship

**Status:** outline

> **Outline.** Expand this into the full template (see [README](README.md#full-template)) at the start of the phase, using what earlier phases learned. Don't build from the outline.

## Goal
Make the project easy for a reviewer to try. Deploy the hosted demo on free tiers, seed a showcase namespace, and write the README and architecture docs. Then verify three reviewer paths from a fresh clone: the hosted demo, `pnpm demo:offline`, and the full quickstart.

## Spec refs
§15 P10 (three reviewer paths), §17 (README requirements), §14 (free stack, pause and keep-alive notes, data terms), §3 (`db:migrate:hosted`), §16 (final identity checks), Appendix C (prior art).

## Depends on
P08 (bench tables) and P09b (demo pages).

## Definition of done
- [ ] Supabase free project created, with `pnpm db:migrate:hosted` applied: portable migrations, revokes and pg_cron schedules. A REST call with the anon key to an `engram` table returns an error.
- [ ] `select jobname, schedule, command from cron.job` on Supabase lists the decay sweep and the demo cleanup with the generated parameters (ledger row 25).
- [ ] Vercel Hobby deploy with env vars set and the transaction-pooler URL with prepared statements off. `/api/mcp` reachable with a bearer token.
- [ ] A seed script loads the showcase namespace (the read-only story from `docs/demo.md`).
- [ ] README per §17:
  - hero gif;
  - what and why;
  - the three reviewer paths;
  - architecture diagram;
  - bench tables;
  - MCP client snippets;
  - design notes;
  - limitations (free-tier data terms, disambiguation, extraction error rates, dependence on clients calling remember, nickname duplicates such as "Rob"/"Robert" (row 15), and that multi-instance deploys rely on synced clocks for record time (row 13));
  - prior art;
  - how to restore a paused Supabase project and re-enable disabled scheduled workflows.
- [ ] `docs/architecture.md` is written. DECISIONS.md is tidied (superseded ADRs marked, not deleted).
- [ ] All three reviewer paths are verified from a fresh clone, step by step against the README:
  1. the hosted demo URL works without signing in;
  2. `pnpm demo:offline` works with only Docker and no keys;
  3. the quickstart takes under 10 minutes with a free Gemini key.
- [ ] Final §16 checks are clean (one author identity, no attribution trailers).

## Risks and verify-at-build-time
- **The hosted demo will need occasional attention**: Supabase pauses and the daily quota cap. The landing page should degrade to the read-only showcase, not an error page.
- **Verify:** current Supabase free-tier limits (DB size, pause policy) and Vercel Hobby limits at deploy time, and write them into the README.
