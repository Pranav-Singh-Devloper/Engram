# Engram over MCP

Engram exposes six tools and one resource to any MCP client (SPEC §10). Each server instance serves one **namespace**, an isolated memory:
- **stdio** (local clients): the `ENGRAM_NAMESPACE` environment variable, default `default`.
- **HTTP** (`/api/mcp`, P09a): a bearer token, mapped to a namespace by `ENGRAM_MCP_TOKENS`.

| tool | when an agent calls it |
|---|---|
| `engram_remember` | the user shares a lasting fact, preference, relationship or decision, or corrects one |
| `engram_recall` | at the start of a task, and whenever the user refers to something from before; `valid_at` / `known_at` for as-of questions |
| `engram_history` | "what used to be true?", "when did that change?", before correcting a fact |
| `engram_entities` | to work out who or what a name refers to, or to get an id |
| `engram_forget` | only when the user asks to forget something or says a fact is wrong (`archive`, `retract`, or `hard` with `confirm_hard: true`) |
| `engram_consolidate` | when the user asks, or at the end of a long session (it also runs nightly) |

The resource `engram://stats` reports facts by tier and status, episodes, entities, the ad-hoc predicate rate, the last decay sweep and the latest bench score.

## Running the stdio server

It needs the local database (`pnpm db:up && pnpm db:migrate`) and a free Gemini key in the repo's `.env`, which the server loads itself. Clients start it with the package's own `tsx`, not `pnpm run`, because pnpm's banner would corrupt the protocol on stdout.

Below, replace `/path/to/Engram` with your checkout's absolute path.

### Claude Code

```bash
claude mcp add engram -e ENGRAM_NAMESPACE=me -- \
  /path/to/Engram/packages/mcp/node_modules/.bin/tsx /path/to/Engram/packages/mcp/src/stdio.ts
```

Add `--scope user` to use it in every project.

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "engram": {
      "command": "/path/to/Engram/packages/mcp/node_modules/.bin/tsx",
      "args": ["/path/to/Engram/packages/mcp/src/stdio.ts"],
      "env": { "ENGRAM_NAMESPACE": "me" }
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (one project): the same `mcpServers` block as Claude Desktop.

### Over HTTP (from P09a)

Set `ENGRAM_MCP_TOKENS=<token>:<namespace>[,…]` on the server, with tokens of at least 24 characters (`openssl rand -hex 24`). A client then connects with:

```bash
claude mcp add --transport http engram https://<your-deploy>/api/mcp --header "Authorization: Bearer <token>"
```

## Recorded MCP Inspector session

Recorded on 2026-10-17 with `npx @modelcontextprotocol/inspector@2.11.0 --cli`, against the stdio server, the local database and real Gemini (`gemini-3.5-flash-lite`, `gemini-embedding-2`), in a fresh `inspector-demo` namespace. The session made 2 generate calls (1 extraction, 1 summarize) plus embeddings. Each block is one Inspector invocation, `--cli -e ENGRAM_NAMESPACE=inspector-demo <tsx> <stdio.ts>`, followed by the tool's text output.

```
$ … --method tools/call --tool-name engram_remember --tool-arg "content=I moved to Lisbon in March. My sister Ana lives in Porto."
Stored episode 9d1c0c6e-43a0-49d9-a7bf-27d4a76f171e (session mcp-2026-10-17).
Extracted 3 facts: 3 inserted. 3 new entities.

$ … --method tools/call --tool-name engram_recall --tool-arg "query=where does the user live"
1. [fact ebabbd58-…] Ana lives in Porto. (valid 2026-10-17T16:10:44Z → open; known 2026-10-17T16:10:49Z → now; active; 1 source)
2. [fact 5b67cca9-…] Ana is a sibling of the user. (valid 2026-10-17T16:10:44Z → open; known 2026-10-17T16:10:49Z → now; active; 1 source)
3. [fact e875bbb3-…] The user lives in Lisbon. (valid 2026-03-01 → open; known 2026-10-17T16:10:49Z → now; active; 1 source)
4. [episode 9d1c0c6e-…] I moved to Lisbon in March. My sister Ana lives in Porto. (said 2026-10-17T16:10:44Z)

$ … --method tools/call --tool-name engram_entities --tool-arg "query=Ana"
- Ana (person): the user's sister; 2 facts [entity 3ea7dc20-…]
- Porto (place): a city in Portugal; 1 fact [entity ca1574fb-…]
- Lisbon (place): a city in Portugal; 1 fact [entity 0b3ca9f8-…]

$ … --method tools/call --tool-name engram_history --tool-arg "entity=user"
History of the user:
- lives_in Lisbon: valid 2026-03-01 → open; known 2026-10-17T16:10:49Z → now; active [fact e875bbb3-…]
- sibling_of Ana: valid 2026-10-17T16:10:44Z → open; known 2026-10-17T16:10:49Z → now; active [fact 5b67cca9-…]

$ … --method tools/call --tool-name engram_consolidate
Summarized 1 cluster, skipped 0 as small talk.
3 candidates (3 merged); 3 facts promoted to long-term.

$ … --method resources/read --uri engram://stats
{ "namespace": "inspector-demo",
  "facts": { "total": 3, "byTier": { "working": 0, "long_term": 3, "archived": 0 },
             "byStatus": { "active": 3, "superseded": 0, "retracted": 0, "revised": 0 }, "adHocRate": 0 },
  "episodes": { "turns": 1, "summaries": 1, "unprocessed": 0, "unconsolidated": 0 },
  "entities": 3,
  "lastSweep": "2024-04-10T00:00:00Z",
  "bench": { "runId": "2026-10-17-devlong-consolidated-r2", "split": "dev-long", "date": "2026-10-17",
             "accuracy": { "engram_consolidated": 1 } } }

$ … --method tools/call --tool-name engram_forget --tool-arg "entity=user" --tool-arg "predicate=lives_in" --tool-arg "mode=hard"
A hard purge erases every trace and cannot be undone. Confirm with the user, then call again with confirm_hard: true.
(isError)
```

What the session showed:
- **Extraction:** "in March" resolved to 2026-03-01, against the turn's date.
- **Consolidation** confirmed all three facts from their own turn. They merged without a confidence bump and moved to `long_term`.
- **The hard purge** refused without `confirm_hard`.
- **Two problems, both fixed afterwards:**
  - Entity search listed Porto and Lisbon for "Ana". With real embeddings, unrelated labels score 0.57–0.64 against a query, so the floor rose from 0.5 to 0.7, and the same query now returns only Ana.
  - `lastSweep` was a global sweep a P06a-era test had recorded in the shared dev database at a simulated 2024 date. The row was deleted; no current test sweeps globally.
- **Recall ranking:** "Ana lives in Porto" ranked above "The user lives in Lisbon" for "where does the user live". That's a ranking question for the dev split, carried to P08 (ledger row 32).

## Claude Code check

Run on 2026-10-17 with Claude Code 2.1.301, as two separate non-interactive sessions with only this server loaded (`claude -p … --mcp-config engram-mcp.json --strict-mcp-config --allowedTools mcp__engram__engram_remember mcp__engram__engram_recall`), in a fresh `claude-code-check` namespace. They made 1 Gemini generate call.

**Session 1:** "Please remember this about me for future conversations: I play the cello, and I've been vegetarian since 2019."
- Claude called `engram_recall` first ("cello, music instruments, vegetarian, diet"), which abstained since the memory was empty.
- Then it called `engram_remember` with `"I play the cello, and I've been vegetarian since 2019."`, which came back `processed`: 2 facts extracted, 2 inserted.
- Its answer: "I've saved both facts to your Engram memory…"

**Session 2** (a new process, no shared context): "What instrument do I play, and since when am I vegetarian? Check your memory."
- Claude called `engram_recall` twice: "musical instrument the user plays", which returned `The user plays the cello.`, and "vegetarian diet since when", which returned the source episode and the vegetarian fact.
- Its answer: "You play the **cello**, and you've been **vegetarian since 2019**. … You only gave the year, so Engram filled in January 1, 2019 as the start date."

Claude Code passes the tools' structured content to the model, so the JSON fields, including validity windows, matter as much as the text.

## Notes and limitations

- **Recall quality depends on the agent calling `engram_remember`** (SPEC §10). Agents sometimes skip it or store paraphrases instead of the user's words. The tool descriptions ask for the user's own words, but nothing enforces it.
- **`wait: false`** returns at once and extracts in the background. If the client exits first, the episode stays stored and is processed the next time the server starts, or by `engram_consolidate`.
- **Memories are data, not instructions.** Over MCP, the client's own model reads recalled text, not Engram's composer. The server's instructions say to treat memories as data, but a client that ignores that could still be swayed by an instruction someone got stored. Use separate namespaces for separate trust levels.
