/**
 * One-glance status of the Gemma subsystem.
 *
 * Prints counts + pass/warn/fail for the pieces someone inheriting the
 * branch would first want to check: services, authored variants, eval
 * reports, deploy preflight, test coverage.
 *
 * Usage: `bun run gemma:status`
 */

import { existsSync, statSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { CUE_ROTATION_VARIANTS } from '@/lib/services/cue-rotator-variants';

const ROOT = process.cwd();

// =============================================================================
// Collect
// =============================================================================

const SERVICES = [
  { name: 'fault-explainer', path: 'lib/services/fault-explainer.ts' },
  { name: 'fault-explainer-cactus', path: 'lib/services/fault-explainer-cactus.ts' },
  { name: 'fault-explainer-edge', path: 'lib/services/fault-explainer-edge.ts' },
  { name: 'fault-explainer-cache', path: 'lib/services/fault-explainer-cache.ts' },
  { name: 'personalized-cue', path: 'lib/services/personalized-cue.ts' },
  { name: 'watch-signal-translator', path: 'lib/services/watch-signal-translator.ts' },
  { name: 'voice-rpe-parser', path: 'lib/services/voice-rpe-parser.ts' },
  { name: 'cue-rotator', path: 'lib/services/cue-rotator.ts' },
  { name: 'fault-synthesis-prompt', path: 'lib/services/fault-synthesis-prompt.ts' },
];

const REPORTS = [
  'docs/evals/fault-synthesis-report.md',
  'docs/evals/voice-rpe-report.md',
  'docs/evals/personalized-cue-report.md',
  'docs/evals/watch-translator-report.md',
];

const DOCS = [
  'docs/GEMMA_RUNTIME_DECISION.md',
  'docs/GEMMA_INTEGRATION_POINTS.md',
  'docs/GEMMA_SUBSYSTEM.md',
];

function fileOk(p: string): { ok: boolean; bytes: number; lines: number } {
  const abs = resolve(ROOT, p);
  if (!existsSync(abs)) return { ok: false, bytes: 0, lines: 0 };
  const bytes = statSync(abs).size;
  const lines = execSync(`wc -l < "${abs}"`, { encoding: 'utf8' }).trim();
  return { ok: true, bytes, lines: parseInt(lines, 10) || 0 };
}

function countTests(): { suites: number; tests: number } | null {
  // Count test files under the Gemma surface. Exact counts require running
  // jest; keep this fast.
  const patterns = [
    'tests/unit/services/fault-explainer*.test.ts',
    'tests/unit/services/fault-synthesis-prompt.test.ts',
    'tests/unit/services/personalized-cue.test.ts',
    'tests/unit/services/watch-signal-translator.test.ts',
    'tests/unit/services/voice-rpe-parser.test.ts',
    'tests/unit/services/cue-rotator.test.ts',
    'tests/unit/hooks/use-fault-synthesis.test.ts',
    'tests/unit/hooks/use-personalized-cue.test.ts',
    'tests/unit/components/form-tracking/FaultSynthesisChip.test.tsx',
  ];
  try {
    const files: string[] = [];
    for (const p of patterns) {
      const matches = execSync(`ls ${p} 2>/dev/null || true`, { encoding: 'utf8', cwd: ROOT })
        .trim()
        .split('\n')
        .filter(Boolean);
      files.push(...matches);
    }
    let tests = 0;
    for (const f of files) {
      const src = execSync(`cat "${resolve(ROOT, f)}"`, { encoding: 'utf8' });
      const matches = src.match(/\b(it|test)\s*\(/g);
      tests += matches ? matches.length : 0;
    }
    return { suites: files.length, tests };
  } catch {
    return null;
  }
}

function preflightStatus(): { ok: boolean; failed: number; warnings: number } {
  const result = spawnSync('bun', ['scripts/fault-synthesis-preflight.ts'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const stdout = result.stdout + '\n' + result.stderr;
  const failedMatch = stdout.match(/FAILED: (\d+)/);
  const warningMatch = stdout.match(/with (\d+) warning/);
  return {
    ok: result.status === 0,
    failed: failedMatch ? parseInt(failedMatch[1] ?? '0', 10) : 0,
    warnings: warningMatch ? parseInt(warningMatch[1] ?? '0', 10) : 0,
  };
}

// =============================================================================
// Render
// =============================================================================

const ICON = { ok: '✓', warn: '•', fail: '✗' } as const;

function row(status: keyof typeof ICON, label: string, value: string): void {
  console.log(`  ${ICON[status]} ${label.padEnd(32)} ${value}`);
}

console.log('\nGemma subsystem status\n');

// Services
const servicesOk = SERVICES.filter((s) => fileOk(s.path).ok).length;
row(
  servicesOk === SERVICES.length ? 'ok' : 'fail',
  'services present',
  `${servicesOk} / ${SERVICES.length}`,
);

// Variants
const variantCount = Object.keys(CUE_ROTATION_VARIANTS).length;
const totalVariants = Object.values(CUE_ROTATION_VARIANTS).reduce((a, v) => a + v.length, 0);
row(
  variantCount >= 25 ? 'ok' : 'warn',
  'cue rotation variants',
  `${variantCount} base cues, ${totalVariants} phrasings`,
);

// Reports
const reportsOk = REPORTS.map(fileOk).filter((f) => f.ok).length;
row(
  reportsOk === REPORTS.length ? 'ok' : 'fail',
  'eval reports committed',
  `${reportsOk} / ${REPORTS.length}`,
);

// Docs
const docsOk = DOCS.map(fileOk).filter((f) => f.ok).length;
row(
  docsOk === DOCS.length ? 'ok' : 'warn',
  'subsystem docs',
  `${docsOk} / ${DOCS.length}`,
);

// Tests
const testInfo = countTests();
if (testInfo) {
  row('ok', 'gemma test surface', `${testInfo.tests} tests across ${testInfo.suites} files`);
} else {
  row('warn', 'gemma test surface', 'could not count');
}

// Preflight
const pre = preflightStatus();
row(
  pre.failed === 0 ? (pre.warnings === 0 ? 'ok' : 'warn') : 'fail',
  'deploy preflight',
  pre.failed > 0
    ? `${pre.failed} blocking failure${pre.failed === 1 ? '' : 's'}`
    : pre.warnings > 0
      ? `${pre.warnings} warning${pre.warnings === 1 ? '' : 's'}`
      : 'clean',
);

// Edge Function
const edgeFn = fileOk('supabase/functions/fault-synthesis/index.ts');
const sharedMirror = fileOk('supabase/functions/_shared/fault-synthesis-prompt.ts');
row(
  edgeFn.ok && sharedMirror.ok ? 'ok' : 'fail',
  'edge function + shared mirror',
  edgeFn.ok ? `${edgeFn.lines} lines + mirrored prompt` : 'missing',
);

// Lab screens
const labs = ['app/labs/fault-synthesis.tsx', 'app/labs/gemma.tsx'];
const labsOk = labs.map(fileOk).filter((f) => f.ok).length;
row(
  labsOk === labs.length ? 'ok' : 'fail',
  'lab screens',
  labsOk === labs.length ? '/labs/fault-synthesis + /labs/gemma' : `${labsOk} / ${labs.length}`,
);

console.log('\nCommands:');
console.log('  bun run gemma:reports          # regenerate eval reports');
console.log('  bun run gemma:preflight        # deploy readiness checklist');
console.log('  bun run gemma:smoke            # post-deploy verification');
console.log('  bun run gemma:check-sync       # shared-prompt drift check');
console.log('  bun run gemma:check-coverage   # cue-variant coverage check\n');
