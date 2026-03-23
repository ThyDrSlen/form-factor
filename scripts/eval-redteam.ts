import { execSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';

const OUTPUT_JSON = 'evals/output/redteam-results.json';
const CONFIG_PATH = 'evals/red-team.yaml';

interface PromptfooOutput {
  results: {
    stats: { successes: number; failures: number; errors: number };
  };
}

function run() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is required to run red team evaluations.');
    process.exit(1);
  }

  mkdirSync('evals/output', { recursive: true });

  console.log('Running red team evaluation...\n');

  try {
    execSync(
      `bunx promptfoo eval -c ${CONFIG_PATH} -o ${OUTPUT_JSON} --no-progress-bar`,
      { stdio: 'inherit', timeout: 600_000 }
    );
  } catch {
    console.error('Promptfoo red team eval failed.');
    process.exit(1);
  }

  const raw = readFileSync(OUTPUT_JSON, 'utf-8');
  const data: PromptfooOutput = JSON.parse(raw);
  const { stats } = data.results;
  const total = stats.successes + stats.failures + stats.errors;
  const passRate = total > 0 ? stats.successes / total : 0;

  console.log(`\nRed Team Results: ${stats.successes}/${total} passed (${(passRate * 100).toFixed(1)}%)`);
  console.log(`Failures: ${stats.failures} | Errors: ${stats.errors}`);

  process.exit(stats.failures > 0 || stats.errors > 0 ? 1 : 0);
}

run();
