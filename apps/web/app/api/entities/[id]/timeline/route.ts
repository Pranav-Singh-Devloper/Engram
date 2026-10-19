import { getRoutes } from '../../../../../src/server/runtime';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  return getRoutes().timeline(req, id);
}
