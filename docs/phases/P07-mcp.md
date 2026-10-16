# P07 — MCP server

**Status:** outline

> **Outline.** Expand this into the full template (see [README](README.md#full-template)) at the start of the phase, using what earlier phases learned. Don't build from the outline.

## Goal
Expose Engram to any MCP client: six tools and a stats resource on the official TypeScript SDK, a stdio binary for local clients, and a transport-agnostic server that P09a mounts over streamable HTTP.

## Spec refs
§10 (tools, resource, namespace selection, transports, known limitation, DoD), §6.1 (`wait` semantics for remember), §6.2 (access tracking for MCP recall), §15 P7.

## Depends on
P06b: every engine capability the tools wrap exists by then (`engram_consolidate`, `engram_forget` modes).

## Definition of done
- [ ] `packages/mcp` with `engram_remember`, `engram_recall`, `engram_history`, `engram_entities`, `engram_forget`, `engram_consolidate` and `engram://stats`. Inputs use zod schemas. Outputs are concise deterministic text plus structured content. Descriptions say *when* to call each tool.
- [ ] stdio entry using `ENGRAM_NAMESPACE`. The transport-agnostic server factory is ready for HTTP mounting with bearer → namespace mapping.
- [ ] An integration test drives the server through the SDK client (in-memory or stdio transport) over the local DB with FakeProvider.
- [ ] Claude Code calls `engram_remember` and `engram_recall` locally (a manual check, written down).
- [ ] An MCP Inspector walkthrough is recorded. Copy-paste configs for Claude Code, Claude Desktop and Cursor are drafted for the README.
- [ ] `engram_forget` with `mode: 'hard'` refuses without `confirm_hard: true`.

## Risks and verify-at-build-time
- **Verify:** the current MCP TypeScript SDK package name, the server and transport APIs, structured-content support, and the stateless streamable-HTTP pattern (needed for Vercel in P09a).
- **The stats resource's "latest bench score"** reads the newest report file. Keep the format stable from P04.
- **Known limitation** (§10): recall depends on agents actually calling remember. Document it, and don't try to engineer around it.
