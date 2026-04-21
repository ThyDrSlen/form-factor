import { notFound } from 'next/navigation';
import { FixtureViewer } from './viewer';
import { fixturesRoot, isDevOnly } from '@/lib/debug/fixtures-root';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-dynamic';

async function listFixtures() {
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
  return entries;
}

export default async function DebugFixturesPage() {
  if (isDevOnly()) notFound();
  const fixtures = await listFixtures();
  return (
    <div className="min-h-screen bg-[#0b1220] text-white">
      <FixtureViewer fixtures={fixtures} />
    </div>
  );
}
