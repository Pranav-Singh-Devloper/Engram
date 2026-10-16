# P09a — Web API

**Status:** outline

> **Outline.** Expand this into the full template (see [README](README.md#full-template)) at the start of the phase, using what earlier phases learned. Don't build from the outline.

## Goal
Create the Next.js app's HTTP surface: thin bearer-protected route handlers over `packages/core`, the streamable-HTTP MCP endpoint, and the anonymous demo flow with cookie namespaces and rate limits that protect the free quota.

## Spec refs
§11 (endpoints, demo flow, per-IP throttle, global daily cap, connection pooling), §10 (HTTP transport, bearer → namespace), §6.1 (post-response `process` in chat), §14 (Vercel Hobby), §15 P9.

## Depends on
P07 (the MCP server factory). P08 isn't required, but `/api/evals` reads its reports.

## Definition of done
- [ ] `apps/web` (Next.js App Router) scaffolded with route handlers for `/api/remember`, `/api/recall`, `/api/memories`, `/api/entities/:id/timeline`, `/api/evals` and `/api/mcp`. All are bearer-protected, and `/api/mcp` is stateless streamable HTTP.
- [ ] `POST /api/demo/session` creates a 24h demo namespace in an httpOnly cookie, throttled per hashed client IP.
- [ ] `POST /api/chat` streams, works only on the cookie namespace, is limited to 30 turns/hour per namespace via `rate_limits`, and respects the global daily cap. Returning the cap message doesn't break the showcase.
- [ ] Chat runs `process()` after the response is sent.
- [ ] Read endpoints are scoped to the cookie namespace or the read-only showcase namespace.
- [ ] Route handler tests cover auth, namespace scoping, both rate limits and the cap (FakeProvider, local DB).

## Risks and verify-at-build-time
- **Transaction pooler:** Vercel connects through Supabase's transaction-mode pooler. Prepared statements must be off in the Postgres client (`prepare: false` in postgres.js). Add a test that a client built from the production config has `prepare` disabled.
- **Advisory locks:** only `pg_advisory_xact_lock` inside a transaction is safe behind the pooler (§6.1). Grep for any session-level lock before deploy.
- **Verify:** the current Next.js post-response API (`after()` at last check), and Vercel Hobby function duration limits against the slowest `process()` call. If that is too slow, chat skips awaiting extraction and relies on post-response work only.
- **Verify:** the current AI SDK version for streaming, if it's used. Ask before adding it.
- **IP hashing:** use a daily-rotated salt, so throttling works without storing identifiable IPs.
