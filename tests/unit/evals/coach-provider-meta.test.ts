/**
 * @jest-environment node
 *
 * Meta-tests for coach-eval.yaml + scenarios (Issue #430 Gap 6).
 *
 * Parses `evals/coach-eval.yaml` and every referenced scenario YAML; asserts
 * each scenario has well-formed description / vars / assert shape AND at
 * least one rubric / contains / threshold guard per scenario.
 *
 * NEW FILE (does NOT modify the existing evals/providers/coach-provider.test.ts,
 * which is outside jest's testMatch but owns the provider-behavior tests).
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parse: yamlLoad } = require('yaml') as { parse: <T = unknown>(s: string) => T };

type ScenarioAssert = {
  type?: string;
  value?: string;
  threshold?: number;
  metric?: string;
};

type Scenario = {
  description?: string;
  vars?: Record<string, unknown>;
  assert?: ScenarioAssert[];
};

function loadYaml<T>(path: string): T {
  return yamlLoad<T>(readFileSync(path, 'utf-8'));
}

// Resolve repo root from tests/unit/evals/
const REPO_ROOT = join(__dirname, '..', '..', '..');
const CONFIG_PATH = join(REPO_ROOT, 'evals', 'coach-eval.yaml');

const config = loadYaml<{
  tests: string[];
  defaultTest?: { assert?: ScenarioAssert[] };
}>(CONFIG_PATH);

describe('coach-eval.yaml — scenario meta-assertions', () => {
  test('coach-eval.yaml declares scenario tests', () => {
    expect(Array.isArray(config.tests)).toBe(true);
    expect(config.tests.length).toBeGreaterThan(0);
  });

  test('defaultTest defines Safety/Quality/Format metric categories', () => {
    expect(config.defaultTest?.assert?.length).toBeGreaterThan(0);
    const metrics = (config.defaultTest?.assert ?? [])
      .map((a) => a.metric ?? '')
      .filter(Boolean);
    const categories = new Set(
      metrics.map((m) => m.split('/')[0]).filter(Boolean),
    );
    expect(categories.has('Safety')).toBe(true);
    expect(categories.has('Quality')).toBe(true);
    expect(categories.has('Format')).toBe(true);
  });

  for (const testRef of config.tests) {
    const scenarioPath = testRef.replace(/^file:\/\//, '');
    const fullPath = join(dirname(CONFIG_PATH), scenarioPath);

    describe(`${scenarioPath}`, () => {
      const scenarios = loadYaml<Scenario[]>(fullPath);

      test('parses as a non-empty array of scenarios', () => {
        expect(Array.isArray(scenarios)).toBe(true);
        expect(scenarios.length).toBeGreaterThan(0);
      });

      test('every scenario has description + vars + >=1 assert', () => {
        for (const sc of scenarios) {
          expect(typeof sc.description).toBe('string');
          expect(sc.vars).toBeDefined();
          expect(Array.isArray(sc.assert)).toBe(true);
          expect((sc.assert ?? []).length).toBeGreaterThan(0);
        }
      });

      test('every scenario has at least 1 rubric / contains / threshold guard', () => {
        for (const sc of scenarios) {
          const asserts = sc.assert ?? [];
          const hasGuard = asserts.some(
            (a) =>
              a.type === 'llm-rubric' ||
              a.type === 'contains' ||
              a.type === 'not-contains' ||
              typeof a.threshold === 'number',
          );
          if (!hasGuard) {
            throw new Error(
              `Scenario "${sc.description}" in ${scenarioPath} lacks rubric / contains / threshold assertion.`,
            );
          }
        }
      });

      test('every llm-rubric assertion has a non-empty metric label', () => {
        for (const sc of scenarios) {
          const rubrics = (sc.assert ?? []).filter(
            (a) => a.type === 'llm-rubric',
          );
          for (const r of rubrics) {
            if (typeof r.metric !== 'string' || r.metric.length === 0) {
              throw new Error(
                `llm-rubric in scenario "${sc.description}" (${scenarioPath}) is missing a metric label`,
              );
            }
          }
        }
      });
    });
  }
});
