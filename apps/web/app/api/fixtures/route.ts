import { NextResponse } from 'next/server';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fixturesRoot, isDevOnly } from '@/lib/debug/fixtures-root';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (isDevOnly()) return new NextResponse('Not Found', { status: 404 });

  const root = fixturesRoot();
  const categories = await readdir(root, { withFileTypes: true });
  const entries: Array<{ category: string; name: string; file: string }> = [];

  for (const c of categories) {
    if (!c.isDirectory()) continue;
    const files = await readdir(path.join(root, c.name));
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      entries.push({ category: c.name, name: f.replace(/\.json$/, ''), file: `${c.name}/${f}` });
    }
  }

  entries.sort((a, b) => a.file.localeCompare(b.file));
  return NextResponse.json({ fixtures: entries });
}
