/**
 * Generate squat tracking fixture JSON files to tests/fixtures/squat-tracking/
 *
 * Usage:
 *   bun run scripts/prepare-squat-fixtures.ts
 *   bun run scripts/prepare-squat-fixtures.ts --out=path/to/dir
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildSquatFixtureCorpus } from '../lib/debug/squat-fixture-corpus';

function main(): void {
  const outArg = process.argv.find((arg) => arg.startsWith('--out='));
  const cwd = process.cwd();
  const outDir = resolve(outArg ? outArg.split('=')[1] : join(cwd, 'tests', 'fixtures', 'squat-tracking'));

  mkdirSync(outDir, { recursive: true });

  const traces = buildSquatFixtureCorpus();
  for (const trace of traces) {
    const filePath = join(outDir, `${trace.name}.json`);
    writeFileSync(filePath, `${JSON.stringify(trace.frames, null, 2)}\n`);
    console.log(`wrote ${trace.frames.length} frames -> ${filePath}`);
  }

  console.log(`\n${traces.length} fixtures written to ${outDir}`);
}

main();
