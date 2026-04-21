import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fixturesRoot, isDevOnly } from '@/lib/debug/fixtures-root';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(_req: Request, ctx: RouteContext) {
  if (isDevOnly()) return new NextResponse('Not Found', { status: 404 });

  const { path: segments } = await ctx.params;
  const root = fixturesRoot();
  const target = path.resolve(root, ...segments);

  if (!target.startsWith(root + path.sep) || !target.endsWith('.json')) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  try {
    const raw = await readFile(target, 'utf8');
    return new NextResponse(raw, {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch {
    return new NextResponse('Not Found', { status: 404 });
  }
}
