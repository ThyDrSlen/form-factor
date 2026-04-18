/**
 * Enforces that every user-facing cue string in `lib/workouts/*.ts` has at
 * least one authored entry in `CUE_ROTATION_VARIANTS`. New cues added
 * without matching variants silently fall through the rotator unchanged
 * — this script fails CI loudly when that gap appears instead of relying
 * on manual review.
 *
 * Run:
 *   bun scripts/check-cue-variants-coverage.ts
 *
 * Wired into `bun run ci:local`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CUE_ROTATION_VARIANTS } from '@/lib/services/cue-rotator-variants';

const WORKOUTS_DIR = resolve(process.cwd(), 'lib/workouts');

interface Finding {
  file: string;
  line: number;
  cue: string;
}

function extractCues(filePath: string): Finding[] {
  const source = readFileSync(filePath, 'utf8');
  const findings: Finding[] = [];
  const lines = source.split('\n');

  // Match: messages.push('...') or messages.push("...")
  // Allow mixed quotes + escaped-apostrophe content. The cue is the
  // captured group, unescaped to match the runtime string value.
  const single = /messages\.push\(\s*'((?:\\'|[^'])*)'\s*\)/g;
  const double = /messages\.push\(\s*"((?:\\"|[^"])*)"\s*\)/g;

  lines.forEach((line, index) => {
    for (const re of [single, double]) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(line)) !== null) {
        const raw = match[1] ?? '';
        // Unescape the capture to get the runtime value.
        const cue = raw.replace(/\\'/g, "'").replace(/\\"/g, '"');
        findings.push({ file: filePath, line: index + 1, cue });
      }
    }
  });

  return findings;
}

function main(): number {
  const files = readdirSync(WORKOUTS_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'helpers.ts' && f !== 'index.ts')
    .map((f) => resolve(WORKOUTS_DIR, f));

  const allFindings: Finding[] = [];
  for (const file of files) {
    allFindings.push(...extractCues(file));
  }

  const declared = new Set(Object.keys(CUE_ROTATION_VARIANTS));
  const uniqueCues = new Set(allFindings.map((f) => f.cue));
  const missing = allFindings.filter((f) => !declared.has(f.cue));

  // Also flag variant keys that no workout emits (stale entries) — not a
  // failure, just a warning.
  const stale = [...declared].filter((key) => !uniqueCues.has(key));

  console.log('\nCue-variant coverage check\n');
  console.log(`  Workout files scanned:     ${files.length}`);
  console.log(`  Unique live cue strings:   ${uniqueCues.size}`);
  console.log(`  Authored variant entries:  ${declared.size}`);

  if (stale.length > 0) {
    console.log('');
    console.log('  • stale variant entries (no workout emits these any more):');
    for (const entry of stale) {
      console.log(`      "${entry}"`);
    }
  }

  if (missing.length === 0) {
    console.log('\n✓ every live cue has at least one authored variant.');
    return 0;
  }

  console.error('\n✗ uncovered cue strings — add entries to lib/services/cue-rotator-variants.ts:\n');
  const groupedByCue = new Map<string, Finding[]>();
  for (const finding of missing) {
    const bucket = groupedByCue.get(finding.cue) ?? [];
    bucket.push(finding);
    groupedByCue.set(finding.cue, bucket);
  }
  for (const [cue, occurrences] of groupedByCue) {
    console.error(`  "${cue}"`);
    for (const occ of occurrences) {
      const rel = occ.file.replace(process.cwd() + '/', '');
      console.error(`      ${rel}:${occ.line}`);
    }
    console.error('');
  }
  return 1;
}

process.exit(main());
