// Typed clients for P09a's endpoints. Responses are parsed with zod, so a
// server/client shape drift fails loudly in tests and in development.
import { z } from 'zod';

const date = z.coerce.date();
const nullableDate = date.nullable();

export const Memory = z.object({
  id: z.string(),
  statement: z.string(),
  predicate: z.string(),
  subjectId: z.string(),
  subjectName: z.string(),
  objectId: z.string().nullable(),
  objectName: z.string(),
  tier: z.enum(['working', 'long_term', 'archived']),
  status: z.string(),
  importance: z.number(),
  accessScore: z.number(),
  lastAccessedAt: nullableDate,
  pinned: z.boolean(),
  validFrom: date,
  validTo: nullableDate,
  recordedAt: date,
  invalidatedAt: nullableDate,
  retention: z.number(),
  sources: z.array(
    z.object({ id: z.string(), role: z.string(), content: z.string(), occurredAt: date }),
  ),
});
export type Memory = z.infer<typeof Memory>;

export const MemoriesPage = z.object({
  total: z.number(),
  truncated: z.boolean(),
  memories: z.array(Memory),
});
export type MemoriesPage = z.infer<typeof MemoriesPage>;

const TimelineFact = z.object({
  id: z.string(),
  statement: z.string(),
  predicate: z.string(),
  status: z.string(),
  tier: z.string(),
  validFrom: date,
  validTo: nullableDate,
  recordedAt: date,
  invalidatedAt: nullableDate,
  revises: z.string().nullable(),
  supersededBy: z.string().nullable(),
});

export const Timeline = z.object({
  entity: z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    description: z.string().nullable(),
    aliases: z.array(z.string()),
    isSelf: z.boolean(),
  }),
  entries: z.array(
    z.object({ fact: TimelineFact.loose(), objectName: z.string(), replaced: z.boolean() }),
  ),
});
export type Timeline = z.infer<typeof Timeline>;
export type TimelineEntry = Timeline['entries'][number];

export const BenchRun = z.object({
  runId: z.string(),
  split: z.string(),
  date: z.string(),
  finishedAt: z.string(),
  retrievalOnly: z.boolean(),
  model: z.string(),
  judge: z.string(),
  items: z.number(),
  modes: z.record(
    z.string(),
    z.object({
      accuracy: z.number(),
      n: z.number(),
      recallAt8: z.number().nullable(),
      requestsPerItem: z.number().optional(),
      promptTokensPerItem: z.number().optional(),
    }),
  ),
  categories: z
    .record(z.string(), z.record(z.string(), z.object({ accuracy: z.number(), n: z.number() })))
    .optional(),
});
export const Agreement = z.object({
  runs: z.array(z.string()),
  pooled: z.object({
    n: z.number(),
    agreement: z.number(),
    kappa: z.number().nullable(),
    humanCorrect: z.number(),
    humanIncorrect: z.number(),
    judgeTooLenient: z.number(),
    judgeTooStrict: z.number(),
  }),
});
export const Evals = z.object({ runs: z.array(BenchRun), agreement: Agreement.nullable() });
export type BenchRun = z.infer<typeof BenchRun>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function getJson<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin', ...init });
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (body as { error?: string }).error ?? `Request failed (${String(res.status)})`;
    throw new ApiError(res.status, message);
  }
  return schema.parse(body);
}

export interface MemoryFilters {
  q?: string;
  tier?: Memory['tier'];
  status?: string;
  predicate?: string;
  all?: boolean;
  limit?: number;
  offset?: number;
}

export function memoriesUrl(f: MemoryFilters = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v !== undefined && v !== '' && v !== false) p.set(k, String(v));
  }
  const qs = p.toString();
  return `/api/memories${qs ? `?${qs}` : ''}`;
}

export const api = {
  memories: (f?: MemoryFilters) => getJson(memoriesUrl(f), MemoriesPage),
  timeline: (id: string, includeRevised = false) =>
    getJson(
      `/api/entities/${encodeURIComponent(id)}/timeline${includeRevised ? '?includeRevised=true' : ''}`,
      Timeline,
    ),
  evals: () => getJson('/api/evals', Evals),
  /** Starts (or returns) the visitor's demo session; the cookie is set by the response. */
  demoSession: () =>
    getJson('/api/demo/session', z.object({ expiresAt: nullableDate, created: z.boolean() }), {
      method: 'POST',
    }),
};
