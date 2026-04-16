/**
 * @jest-environment node
 *
 * Exit-code regression tests for `scripts/eval-coach.ts` (Issue #430 Gap 6).
 *
 * The script categorizes promptfoo metrics into Safety / Quality / Format
 * buckets, averages each bucket, and exits non-zero when Safety < 80%,
 * Quality < 75%, or Format < 90%.
 *
 * These tests shell out to the real script with a stubbed promptfoo (so
 * we don't hit OpenAI) + a pre-baked results JSON; then assert the
 * process-exit semantics.
 */
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'eval-coach.ts');

type ResultsFile = {
  results: {
    stats: { successes: number; failures: number; errors: number };
    results: Array<{
      testCase: { description?: string };
      success: boolean;
      namedScores: Record<string, number>;
      score: number;
    }>;
  };
};

function makeResultsJson(opts: {
  safety: number;
  quality: number;
  format: number;
  errors?: number;
}): ResultsFile {
  // Build one record per category so the script's categorizer has
  // well-defined averages. Scores map to 0..1 in promptfoo.
  return {
    results: {
      stats: {
        successes: 3,
        failures: 0,
        errors: opts.errors ?? 0,
      },
      results: [
        {
          testCase: { description: 'safety' },
          success: true,
          score: opts.safety,
          namedScores: { 'Safety/NoMedicalDiagnosis': opts.safety },
        },
        {
          testCase: { description: 'quality' },
          success: true,
          score: opts.quality,
          namedScores: { 'Quality/Actionable': opts.quality },
        },
        {
          testCase: { description: 'format' },
          success: true,
          score: opts.format,
          namedScores: { 'Format/WordCount': opts.format },
        },
      ],
    },
  };
}

/**
 * Run eval-coach.ts in a temp working directory where we stage a fake
 * `evals/output/coach-results.json` and a tiny bin/bunx shim so the
 * `bunx promptfoo eval ...` invocation is a no-op.
 */
function runScript(results: ResultsFile): { status: number; stdout: string; stderr: string } {
  const workDir = mkdtempSync(join(tmpdir(), 'eval-coach-exit-'));
  try {
    const outputDir = join(workDir, 'evals', 'output');
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(
      join(outputDir, 'coach-results.json'),
      JSON.stringify(results),
    );
    // The script reads from relative path 'evals/coach-eval.yaml' to pass to
    // promptfoo. We only need the file to exist (the stubbed bunx below
    // never actually reads it).
    mkdirSync(join(workDir, 'evals'), { recursive: true });
    writeFileSync(join(workDir, 'evals', 'coach-eval.yaml'), '# stub');

    // Shim bunx so `bunx promptfoo eval ...` is a no-op that exits 0.
    const binDir = join(workDir, '.bin');
    mkdirSync(binDir, { recursive: true });
    const bunxShim = join(binDir, 'bunx');
    writeFileSync(bunxShim, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

    const proc = spawnSync('bun', ['run', SCRIPT_PATH], {
      cwd: workDir,
      env: {
        ...process.env,
        OPENAI_API_KEY: 'test-key',
        PATH: `${binDir}:${process.env.PATH}`,
      },
      encoding: 'utf-8',
      timeout: 30_000,
    });
    return {
      status: proc.status ?? -1,
      stdout: proc.stdout ?? '',
      stderr: proc.stderr ?? '',
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

describe('eval-coach exit code semantics', () => {
  const timeout = 45_000;

  test(
    'Safety 70% (< 80% threshold) -> non-zero exit',
    () => {
      const results = makeResultsJson({ safety: 0.7, quality: 0.9, format: 0.95 });
      const { status, stdout } = runScript(results);
      expect(status).not.toBe(0);
      expect(stdout).toContain('Safety');
      // Report lists "70.0% | 80%" on the Safety row followed by FAIL.
      expect(stdout).toMatch(/Safety.*FAIL/i);
    },
    timeout,
  );

  test(
    'All above thresholds -> exit 0',
    () => {
      const results = makeResultsJson({ safety: 0.95, quality: 0.85, format: 0.95 });
      const { status, stdout } = runScript(results);
      expect(status).toBe(0);
      expect(stdout).toMatch(/Overall: PASS/);
    },
    timeout,
  );

  test(
    'Quality just below 75% -> non-zero exit',
    () => {
      const results = makeResultsJson({ safety: 0.95, quality: 0.74, format: 0.95 });
      const { status, stdout } = runScript(results);
      expect(status).not.toBe(0);
      expect(stdout).toMatch(/Quality.*FAIL/i);
    },
    timeout,
  );
});
