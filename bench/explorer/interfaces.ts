// Build-time data for the explorer's interfaces and benchmarks chapters (P09c
// chapters 11–13). The MCP catalog comes from the real stdio server over raw
// JSON-RPC, as an MCP client sees it; benchmark numbers come from the
// committed report summaries.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_DATABASE_URL, createDb } from '@engram/core';

const ROOT = path.resolve(import.meta.dirname, '../..');
const MCP = path.join(ROOT, 'packages/mcp');

interface RpcReply {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message: string };
}

/** tools/list and resources/list from the stdio server, which needs no model call to answer. */
export async function mcpCatalog() {
  const slug = `explorer-mcp-${randomUUID().slice(0, 8)}`;
  const child = spawn(path.join(MCP, 'node_modules/.bin/tsx'), [path.join(MCP, 'src/stdio.ts')], {
    env: {
      PATH: process.env.PATH ?? '',
      ENGRAM_NAMESPACE: slug,
      DATABASE_URL: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
      GEMINI_API_KEY: 'unused-for-listing',
      GEMINI_API_KEY_FALLBACK: '',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const waiting = new Map<number, (r: RpcReply) => void>();
  let buffer = '';
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line) as RpcReply;
      if (msg.id !== undefined) waiting.get(msg.id)?.(msg);
    }
  });
  let next = 0;
  const call = (method: string, params: object = {}) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const id = ++next;
      const timer = setTimeout(() => {
        reject(new Error(`MCP ${method} timed out`));
      }, 30_000);
      waiting.set(id, (r) => {
        clearTimeout(timer);
        if (r.error) reject(new Error(r.error.message));
        else resolve(r.result ?? {});
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  try {
    const init = await call('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'engram-explorer', version: '0' },
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
    );
    const { tools } = (await call('tools/list')) as {
      tools: {
        name: string;
        title?: string;
        description?: string;
        inputSchema: {
          properties?: Record<string, { type?: unknown; description?: string }>;
          required?: string[];
        };
        annotations?: Record<string, boolean>;
      }[];
    };
    const { resources } = (await call('resources/list')) as {
      resources: { uri: string; name: string; title?: string; description?: string }[];
    };
    return {
      server: (init.serverInfo ?? null) as { name: string; version: string } | null,
      protocolVersion: init.protocolVersion as string,
      tools: tools.map((t) => ({
        name: t.name,
        title: t.title ?? t.name,
        description: t.description ?? '',
        params: Object.entries(t.inputSchema.properties ?? {}).map(([name, p]) => ({
          name,
          type: Array.isArray(p.type)
            ? p.type.join(' | ')
            : typeof p.type === 'string'
              ? p.type
              : 'object',
          required: (t.inputSchema.required ?? []).includes(name),
          description: p.description ?? '',
        })),
        annotations: t.annotations ?? {},
      })),
      resources,
    };
  } finally {
    child.stdin.end();
    child.kill();
    const db = createDb(process.env.DATABASE_URL || DEFAULT_DATABASE_URL, { max: 1 });
    await db`delete from namespaces where slug = ${slug}`;
    await db.end();
  }
}

const report = (run: string) =>
  JSON.parse(readFileSync(path.join(ROOT, 'bench/reports', `${run}.json`), 'utf8')) as {
    runId: string;
    split: string;
    items: number;
    model: string;
    judge: string;
    modes: Record<
      string,
      {
        accuracy: number;
        n: number;
        recallAt8: number | null;
        requestsPerItem?: number;
        promptTokensPerItem?: number;
      }
    >;
    categories?: Record<string, Record<string, { accuracy: number; n: number }>>;
  };

/** P08b's local-mode ablation (docs/local.md), one report per row. */
export const ABLATION = [
  {
    row: 'A',
    run: '2026-10-18-devlong-session',
    generation: 'Gemini 3.5 flash-lite',
    embeddings: 'gemini-embedding-2',
  },
  {
    row: 'B',
    run: '2026-10-19-devlong-local-B',
    generation: 'qwen3.5:9b',
    embeddings: 'gemini-embedding-2',
  },
  {
    row: 'C',
    run: '2026-10-18-devlong-local-C-counted',
    generation: 'qwen3.5:9b',
    embeddings: 'embeddinggemma:300m',
  },
  {
    row: 'C′',
    run: '2026-10-18-devlong-local-C-guard',
    generation: 'qwen3.5:9b + one extraction rule',
    embeddings: 'embeddinggemma:300m',
  },
] as const;

export const HEADLINE_RUNS = ['2026-10-18-test', '2026-10-19-longmemeval'] as const;
export const AGREEMENT = 'agreement-2026-10-18-test+2026-10-19-longmemeval';

export function benchData() {
  const spike = (f: string) =>
    (JSON.parse(readFileSync(path.join(ROOT, 'bench/spikes', f), 'utf8')) as { summary: unknown })
      .summary;
  return {
    headline: HEADLINE_RUNS.map((r) => {
      const { runId, split, items, model, judge, modes, categories } = report(r);
      return { runId, split, items, model, judge, modes, categories: categories ?? {} };
    }),
    ablation: ABLATION.map((a) => {
      const r = report(a.run);
      const e = r.modes.engram;
      if (!e) throw new Error(`${a.run} has no engram mode`);
      return {
        ...a,
        accuracy: e.accuracy,
        recallAt8: e.recallAt8,
        categories: Object.fromEntries(
          Object.entries(r.categories ?? {}).map(([c, byMode]) => [c, byMode.engram ?? null]),
        ),
      };
    }),
    agreement: JSON.parse(
      readFileSync(path.join(ROOT, 'bench/reports', `${AGREEMENT}.json`), 'utf8'),
    ) as unknown,
    transport: [spike('transport-ollama.json'), spike('transport-llamacpp.json')],
  };
}
