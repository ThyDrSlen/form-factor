/**
 * @jest-environment node
 *
 * CI workflow regression test (Issue #430 Gap 6, tracked by #298).
 *
 * Parses `.github/workflows/ci-cd.yml` and pins the `ai-eval` job's
 * `continue-on-error` value. If #298 is resolved and the flag flips
 * from `true` to `false`, this test catches the change and forces a
 * deliberate update of the expected value.
 *
 * Also asserts structural invariants so a future refactor can't silently
 * drop the job or move `continue-on-error` to a step (which would
 * not gate the overall workflow).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parse: yamlLoad } = require('yaml') as {
  parse: <T = unknown>(s: string) => T;
};

type Workflow = {
  jobs: Record<
    string,
    {
      name?: string;
      'continue-on-error'?: boolean;
      needs?: string[] | string;
      if?: string;
      steps?: Array<Record<string, unknown>>;
    }
  >;
};

const REPO_ROOT = join(__dirname, '..', '..', '..');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'ci-cd.yml');

describe('ci-cd.yml ai-eval job — continue-on-error regression guard', () => {
  const workflow = yamlLoad<Workflow>(readFileSync(WORKFLOW_PATH, 'utf-8'));

  test('ai-eval job exists', () => {
    expect(workflow.jobs['ai-eval']).toBeDefined();
  });

  test('ai-eval.continue-on-error is the documented value (currently true, tracked by #298)', () => {
    // When #298 is resolved and we want the ai-eval gate to block PR merges,
    // flip the expected value here AND in the workflow file together.
    const EXPECTED = true;
    expect(workflow.jobs['ai-eval']['continue-on-error']).toBe(EXPECTED);
  });

  test('ai-eval depends on quality + changes jobs (runs only when app_code changed)', () => {
    const needs = workflow.jobs['ai-eval'].needs;
    expect(Array.isArray(needs)).toBe(true);
    expect(needs).toContain('changes');
    expect(needs).toContain('quality');
  });
});
