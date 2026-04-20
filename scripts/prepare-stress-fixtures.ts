import { buildStressFixtureCorpus } from '../lib/debug/stress-fixture-corpus';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(process.cwd(), 'tests', 'fixtures', 'stress-tracking');
fs.mkdirSync(dir, { recursive: true });

const corpus = buildStressFixtureCorpus();
for (const trace of corpus) {
  const filePath = path.join(dir, `${trace.name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(trace.frames, null, 2));
  console.log(`Wrote ${trace.frames.length} frames to ${filePath}`);
}
console.log(`\nGenerated ${corpus.length} stress test fixtures`);
