import { getRoutes } from '../../../src/server/runtime';

export const dynamic = 'force-dynamic';

export function GET(): Promise<Response> {
  return getRoutes().health();
}
