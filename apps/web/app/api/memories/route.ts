import { getRoutes } from '../../../src/server/runtime';

export const dynamic = 'force-dynamic';

export function GET(req: Request): Promise<Response> {
  return getRoutes().memories(req);
}
