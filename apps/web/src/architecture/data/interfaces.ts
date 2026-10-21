// The interfaces chapter (P09c chapter 12): the MCP catalog as the real stdio
// server lists it (bench explorer:data), and the REST surface with who may
// call what. interfaces.test.ts checks the routes against app/api and the
// limits against the server's.
import raw from '@/content/generated/interfaces.json';

export interface McpTool {
  name: string;
  title: string;
  description: string;
  params: { name: string; type: string; required: boolean; description: string }[];
  annotations: Record<string, boolean>;
}

export const MCP_CATALOG = raw as {
  server: { name: string; version: string } | null;
  protocolVersion: string;
  tools: McpTool[];
  resources: { uri: string; name: string; title?: string; description?: string }[];
};

/** Who can call: an MCP/REST bearer token, the demo cookie, nobody (falls back to the read-only showcase), or anyone. */
export type Credential = 'token' | 'cookie' | 'none';
export type Grant = 'own namespace' | 'demo namespace' | 'showcase, read-only' | 'public' | '401';

export interface Route {
  path: string;
  methods: string[];
  what: string;
  access: Record<Credential, Grant>;
  limits?: string;
}

const read = {
  token: 'own namespace',
  cookie: 'demo namespace',
  none: 'showcase, read-only',
} as const;
const tokenOnly = { token: 'own namespace', cookie: '401', none: '401' } as const;
const open = { token: 'public', cookie: 'public', none: 'public' } as const;

export const ROUTES: Route[] = [
  {
    path: '/api/health',
    methods: ['GET'],
    what: 'database reachable, schema in place',
    access: open,
  },
  {
    path: '/api/evals',
    methods: ['GET'],
    what: 'bench summaries and judge agreement (public by decision, ADR-019)',
    access: open,
  },
  {
    path: '/api/demo/session',
    methods: ['POST'],
    what: 'mints a demo namespace and sets its cookie',
    access: open,
    limits: 'per IP: 5 an hour, 20 a day',
  },
  {
    path: '/api/chat',
    methods: ['POST'],
    what: 'recall → compose, streamed as memories · answer · done',
    access: { token: '401', cookie: 'demo namespace', none: '401' },
    limits: '30 turns an hour per namespace; 120 a day in total',
  },
  {
    path: '/api/memories',
    methods: ['GET'],
    what: 'facts ranked by retention score',
    access: read,
  },
  {
    path: '/api/entities/[id]/timeline',
    methods: ['GET'],
    what: 'an entity’s versions on both time axes',
    access: read,
  },
  { path: '/api/stats', methods: ['GET'], what: 'what the namespace holds', access: read },
  { path: '/api/remember', methods: ['POST'], what: 'store a turn; extract it', access: tokenOnly },
  { path: '/api/recall', methods: ['POST'], what: 'recall with as-of options', access: tokenOnly },
  {
    path: '/api/mcp',
    methods: ['POST', 'GET', 'DELETE'],
    what: 'the six MCP tools over streamable HTTP',
    access: tokenOnly,
  },
];

/** apps/web/src/server/limits.ts LIMITS, and the default global cap (config.ts). */
export const DEMO_LIMITS = {
  sessionsPerIpHour: 5,
  sessionsPerIpDay: 20,
  turnsPerNamespaceHour: 30,
  dailyTurnCap: 120,
};

/** One step of a sequence diagram: an arrow between two lanes. */
export interface Step {
  from: string;
  to: string;
  label: string;
  note?: string;
  /** Runs after the response is sent (Next's after(), or a background task). */
  deferred?: boolean;
}

export const SEQUENCES: Record<string, { title: string; lanes: string[]; steps: Step[] }> = {
  mcp: {
    title: 'An agent remembers, then recalls (MCP, Gemini)',
    lanes: ['agent', 'MCP server', 'engine', 'Gemini', 'Postgres'],
    steps: [
      { from: 'agent', to: 'MCP server', label: 'engram_remember("I moved to Berlin in March")' },
      { from: 'MCP server', to: 'engine', label: 'ingest' },
      { from: 'engine', to: 'Gemini', label: 'embed the turn' },
      { from: 'engine', to: 'Postgres', label: 'insert the episode' },
      {
        from: 'engine',
        to: 'Gemini',
        label: 'extract: facts, entities, time hints (zod-validated)',
      },
      { from: 'engine', to: 'Gemini', label: 'embed statements and entity labels' },
      {
        from: 'engine',
        to: 'Postgres',
        label: 'resolve under the namespace lock: insert, close, invalidate',
        note: 'one transaction',
      },
      {
        from: 'MCP server',
        to: 'agent',
        label: 'stored: 1 extracted, outcome update',
        note: 'wait defaults to true on Gemini; local mode returns at once and extracts in the background',
      },
      { from: 'agent', to: 'MCP server', label: 'engram_recall("where do I live?")' },
      { from: 'engine', to: 'Gemini', label: 'embed the query' },
      { from: 'engine', to: 'Postgres', label: 'four candidate lists under the as-of filter' },
      { from: 'MCP server', to: 'agent', label: 'Berlin (valid since Mar 2024), with provenance' },
    ],
  },
  chat: {
    title: 'A visitor chats (web demo)',
    lanes: ['browser', 'route', 'engine', 'Gemini', 'Postgres'],
    steps: [
      { from: 'browser', to: 'route', label: 'POST /api/chat (demo cookie)' },
      {
        from: 'route',
        to: 'Postgres',
        label: 'limits: namespace 30/h, global 120/day (one upsert each)',
      },
      {
        from: 'route',
        to: 'engine',
        label: 'recall before storing the turn',
        note: 'otherwise the question finds itself at similarity 1.0 (ADR-019)',
      },
      { from: 'route', to: 'browser', label: 'event: memories' },
      {
        from: 'route',
        to: 'Postgres',
        label: 'embed and store the visitor’s turn',
        note: 'before composing, so the message survives a failed reply',
      },
      { from: 'engine', to: 'Gemini', label: 'compose: answer + used memory ids (JSON)' },
      { from: 'route', to: 'browser', label: 'event: answer' },
      {
        from: 'route',
        to: 'Postgres',
        label: 'store the reply only if memory supported it; count use of the memories it used',
      },
      { from: 'route', to: 'browser', label: 'event: done' },
      { from: 'engine', to: 'Gemini', label: 'extract the turn', deferred: true },
      { from: 'engine', to: 'Postgres', label: 'resolve and write facts', deferred: true },
    ],
  },
};
