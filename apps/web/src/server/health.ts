// GET /api/health: proves a deployed function resolves unqualified names to
// the engram schema. Neon's proxy drops the search_path startup parameter, so
// this relies on the database default from sql/hosted/0002 (ADR-014; P09a
// decision 10, ledger row 35).
import type { Sql } from '@engram/core';

export async function health(db: Sql): Promise<Response> {
  const [row] = await db<{ schema: string; namespaces: number }[]>`
    select current_schema() as schema, (select count(*)::int from namespaces) as namespaces`;
  return Response.json({ ok: row?.schema === 'engram', schema: row?.schema ?? null });
}
