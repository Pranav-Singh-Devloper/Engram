import { getRoutes } from '../../../src/server/runtime';

export const dynamic = 'force-dynamic';

// Stateless streamable HTTP (SPEC §10): every method goes to the same handler.
export function POST(req: Request): Promise<Response> {
  return getRoutes().mcp(req);
}
export function GET(req: Request): Promise<Response> {
  return getRoutes().mcp(req);
}
export function DELETE(req: Request): Promise<Response> {
  return getRoutes().mcp(req);
}
