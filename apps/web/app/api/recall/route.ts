import { getRoutes } from '../../../src/server/runtime';

export const dynamic = 'force-dynamic';

export function POST(req: Request): Promise<Response> {
  return getRoutes().recall(req);
}
