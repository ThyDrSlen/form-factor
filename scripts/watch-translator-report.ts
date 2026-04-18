/**
 * Generate a markdown report of watch-signal-translator output across
 * canonical signal permutations that stress every rule path (plus edge
 * cases). Commit the output for regression-baseline diffs.
 *
 * Run:
 *   bun scripts/watch-translator-report.ts
 *   bun scripts/watch-translator-report.ts --out docs/evals/watch-translator-report.md
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  staticWatchSignalTranslator,
  type WatchSignals,
} from '@/lib/services/watch-signal-translator';

const DEFAULT_OUT = 'docs/evals/watch-translator-report.md';

interface Case {
  category: string;
  description: string;
  signals: WatchSignals;
}

const HR_MAX = 190;

const CASES: Case[] = [
  // Rule 1: working + HR >= 90%
  {
    category: 'Rule 1 · redlining',
    description: 'Working set at 92% max HR',
    signals: { hrBpm: Math.round(HR_MAX * 0.92), hrMaxBpm: HR_MAX, cadenceRpm: 30, phaseState: 'working', lastRepEccentricSec: 1.2 },
  },
  {
    category: 'Rule 1 · redlining',
    description: 'Working set right at 90% threshold',
    signals: { hrBpm: Math.round(HR_MAX * 0.90), hrMaxBpm: HR_MAX, cadenceRpm: 25, phaseState: 'working', lastRepEccentricSec: 1.5 },
  },

  // Rule 2: working + HR < 60%
  {
    category: 'Rule 2 · plenty of gas',
    description: 'Working set at 50% max HR',
    signals: { hrBpm: Math.round(HR_MAX * 0.50), hrMaxBpm: HR_MAX, cadenceRpm: 20, phaseState: 'working', lastRepEccentricSec: 1.5 },
  },

  // Rule 3: working + fast eccentric
  {
    category: 'Rule 3 · slow the eccentric',
    description: 'Working set with 0.4s eccentric',
    signals: { hrBpm: Math.round(HR_MAX * 0.75), hrMaxBpm: HR_MAX, cadenceRpm: 28, phaseState: 'working', lastRepEccentricSec: 0.4 },
  },

  // Rule 4: rest + HR > 75%
  {
    category: 'Rule 4 · extend rest',
    description: 'Resting with HR still at 80% max',
    signals: { hrBpm: Math.round(HR_MAX * 0.80), hrMaxBpm: HR_MAX, cadenceRpm: 0, phaseState: 'rest', lastRepEccentricSec: 0 },
  },

  // Rule 5: warmup + HR < 40%
  {
    category: 'Rule 5 · warmup bump',
    description: 'Warmup with HR at 35% max',
    signals: { hrBpm: Math.round(HR_MAX * 0.35), hrMaxBpm: HR_MAX, cadenceRpm: 40, phaseState: 'warmup', lastRepEccentricSec: 1.2 },
  },

  // Default rule
  {
    category: 'Default rule',
    description: 'Steady working set, nothing flagged',
    signals: { hrBpm: Math.round(HR_MAX * 0.75), hrMaxBpm: HR_MAX, cadenceRpm: 28, phaseState: 'working', lastRepEccentricSec: 1.5 },
  },
  {
    category: 'Default rule',
    description: 'Cooldown phase',
    signals: { hrBpm: Math.round(HR_MAX * 0.55), hrMaxBpm: HR_MAX, cadenceRpm: 0, phaseState: 'cooldown', lastRepEccentricSec: 0 },
  },
  {
    category: 'Default rule',
    description: 'Rest phase with recovered HR',
    signals: { hrBpm: Math.round(HR_MAX * 0.55), hrMaxBpm: HR_MAX, cadenceRpm: 0, phaseState: 'rest', lastRepEccentricSec: 0 },
  },

  // Priority / edge cases
  {
    category: 'Priority + edge',
    description: 'Redlining AND fast eccentric — HR rule wins (priority 1 beats 3)',
    signals: { hrBpm: Math.round(HR_MAX * 0.95), hrMaxBpm: HR_MAX, cadenceRpm: 30, phaseState: 'working', lastRepEccentricSec: 0.3 },
  },
  {
    category: 'Priority + edge',
    description: 'Invalid hrMaxBpm (0) — HR rules skipped, falls through',
    signals: { hrBpm: 170, hrMaxBpm: 0, cadenceRpm: 28, phaseState: 'working', lastRepEccentricSec: 0.4 },
  },
  {
    category: 'Priority + edge',
    description: 'Negative hrMaxBpm — graceful default',
    signals: { hrBpm: 150, hrMaxBpm: -10, cadenceRpm: 0, phaseState: 'rest', lastRepEccentricSec: 0 },
  },
];

function parseArgs(argv: string[]): { out: string } {
  let out = DEFAULT_OUT;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out' && typeof argv[i + 1] === 'string') {
      out = argv[i + 1]!;
      i += 1;
    }
  }
  return { out };
}

function signalsLine(s: WatchSignals): string {
  const ratio = s.hrMaxBpm > 0 ? `${Math.round((s.hrBpm / s.hrMaxBpm) * 100)}% max` : 'invalid hrMax';
  return `\`hr ${s.hrBpm}bpm (${ratio}), cadence ${s.cadenceRpm}rpm, phase ${s.phaseState}, last eccentric ${s.lastRepEccentricSec}s\``;
}

async function generateReport(): Promise<string> {
  const lines: string[] = [];
  lines.push('# Watch Signal Translator Report');
  lines.push('');
  lines.push(
    'Deterministic output of `staticWatchSignalTranslator` across canonical signal permutations that stress every rule path and the default. Regenerate with `bun scripts/watch-translator-report.ts`.',
  );
  lines.push('');
  lines.push(`- Total cases: **${CASES.length}**`);
  lines.push(`- Source: rule-based (no LLM yet)`);
  lines.push('');

  const byCategory = new Map<string, Case[]>();
  for (const c of CASES) {
    const bucket = byCategory.get(c.category) ?? [];
    bucket.push(c);
    byCategory.set(c.category, bucket);
  }

  for (const [category, cases] of byCategory) {
    lines.push(`## ${category}`);
    lines.push('');
    for (const c of cases) {
      const output = await staticWatchSignalTranslator.translate(c.signals);
      lines.push(`### ${c.description}`);
      lines.push('');
      lines.push(`- **Signals:** ${signalsLine(c.signals)}`);
      lines.push('');
      lines.push(`> ${output.cue}`);
      lines.push('');
      lines.push(`- **Tone:** \`${output.tone}\``);
      lines.push(`- **Source:** \`${output.source}\``);
      lines.push('');
    }
  }

  return lines.join('\n');
}

async function main() {
  const { out } = parseArgs(process.argv.slice(2));
  const report = await generateReport();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, report);
  console.log(`Wrote ${out}`);
  console.log(`  Cases evaluated: ${CASES.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
