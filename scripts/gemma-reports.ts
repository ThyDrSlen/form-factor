/**
 * Regenerates every Gemma-adjacent eval report in one pass.
 *
 * Use whenever a service's static fallback, a glossary entry, a cue rule,
 * or an authored variant changes — re-baselining all four reports keeps
 * `git diff docs/evals/` an honest snapshot of current output quality.
 *
 * Usage:
 *   bun scripts/gemma-reports.ts
 *   bun run gemma:reports   # shortcut via package.json
 */

import { spawnSync } from 'node:child_process';

interface ReportTarget {
  label: string;
  script: string;
  output: string;
}

const TARGETS: ReportTarget[] = [
  {
    label: 'Fault synthesis',
    script: 'scripts/synthesis-report.ts',
    output: 'docs/evals/fault-synthesis-report.md',
  },
  {
    label: 'Voice RPE',
    script: 'scripts/voice-rpe-report.ts',
    output: 'docs/evals/voice-rpe-report.md',
  },
  {
    label: 'Personalized cue',
    script: 'scripts/personalized-cue-report.ts',
    output: 'docs/evals/personalized-cue-report.md',
  },
  {
    label: 'Watch translator',
    script: 'scripts/watch-translator-report.ts',
    output: 'docs/evals/watch-translator-report.md',
  },
];

function runOne(target: ReportTarget): boolean {
  const startedAt = Date.now();
  const result = spawnSync('bun', [target.script], { stdio: 'pipe', encoding: 'utf8' });
  const elapsedMs = Date.now() - startedAt;

  if (result.status === 0) {
    console.log(`  ✓ ${target.label.padEnd(20)} → ${target.output} (${elapsedMs}ms)`);
    return true;
  }

  console.error(`  ✗ ${target.label} FAILED (${elapsedMs}ms, exit ${result.status ?? 'null'})`);
  if (result.stdout) console.error(`    stdout: ${result.stdout.trim()}`);
  if (result.stderr) console.error(`    stderr: ${result.stderr.trim()}`);
  return false;
}

function main(): number {
  console.log('\nRegenerating Gemma eval reports\n');
  const startedAt = Date.now();
  const results = TARGETS.map(runOne);
  const elapsedMs = Date.now() - startedAt;
  const failed = results.filter((ok) => !ok).length;

  console.log('');
  if (failed === 0) {
    console.log(
      `All ${TARGETS.length} reports regenerated in ${elapsedMs}ms. ` +
        `Run \`git diff docs/evals/\` to review changes.`,
    );
    return 0;
  }

  console.error(`${failed} of ${TARGETS.length} report${TARGETS.length === 1 ? '' : 's'} failed — see errors above.`);
  return 1;
}

process.exit(main());
