import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildPullupFixtureCorpus } from '../lib/debug/pullup-fixture-corpus';

const ROOT = process.cwd();
const FIXTURE_DIR = join(ROOT, 'tests', 'fixtures', 'pullup-tracking');

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function main(): void {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const corpus = buildPullupFixtureCorpus();

  const written: Array<{ fileName: string; checksum: string; changed: boolean }> = [];

  for (const fixture of corpus) {
    const fileName = `${fixture.name}.json`;
    const filePath = join(FIXTURE_DIR, fileName);
    const payload = `${JSON.stringify(fixture.frames, null, 2)}\n`;
    let previous = '';
    try {
      previous = readFileSync(filePath, 'utf8');
    } catch {
      previous = '';
    }

    const changed = previous !== payload;
    if (changed) {
      writeFileSync(filePath, payload, 'utf8');
    }

    written.push({ fileName, checksum: sha256(payload), changed });
  }

  const changedCount = written.filter((entry) => entry.changed).length;
  console.log(`[fixtures:pullup:prepare] dir=${FIXTURE_DIR}`);
  for (const entry of written) {
    const state = entry.changed ? 'updated' : 'ok';
    console.log(`${state} ${entry.fileName} ${entry.checksum}`);
  }
  console.log(`[fixtures:pullup:prepare] total=${written.length} changed=${changedCount}`);
}

main();
