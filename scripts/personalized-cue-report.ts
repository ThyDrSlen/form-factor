/**
 * Generate a markdown report of personalized-cue output across canonical
 * (exerciseId, faultId, history) cases. Commit the output for
 * regression-baseline diffs.
 *
 * Run:
 *   bun scripts/personalized-cue-report.ts
 *   bun scripts/personalized-cue-report.ts --out docs/evals/personalized-cue-report.md
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { staticPersonalizedCueRunner, type UserFaultHistoryItem } from '@/lib/services/personalized-cue';

const DEFAULT_OUT = 'docs/evals/personalized-cue-report.md';

interface Case {
  category: string;
  description: string;
  exerciseId: string;
  faultId: string;
  userHistory?: UserFaultHistoryItem[];
}

const CASES: Case[] = [
  // First-timer baseline across exercises
  { category: 'First-timer', description: 'Squat — shallow depth', exerciseId: 'squat', faultId: 'shallow_depth' },
  { category: 'First-timer', description: 'Squat — knees caving', exerciseId: 'squat', faultId: 'knee_valgus' },
  { category: 'First-timer', description: 'Push-up — hip sag', exerciseId: 'pushup', faultId: 'hip_sag' },
  { category: 'First-timer', description: 'Deadlift — rounded back', exerciseId: 'deadlift', faultId: 'rounded_back' },
  { category: 'First-timer', description: 'Bench press — elbow flare', exerciseId: 'benchpress', faultId: 'elbow_flare' },

  // Explicit zero-occurrence history (also counts as first-timer)
  {
    category: 'First-timer',
    description: 'Explicit zero occurrences',
    exerciseId: 'squat',
    faultId: 'shallow_depth',
    userHistory: [{ faultId: 'shallow_depth', lastSeenSessionsAgo: 0, totalOccurrences: 0 }],
  },

  // Repeat offender: 3+ occurrences, recent
  {
    category: 'Repeat offender (prepends "third session")',
    description: 'Squat shallow depth — 4 recent sessions',
    exerciseId: 'squat',
    faultId: 'shallow_depth',
    userHistory: [{ faultId: 'shallow_depth', lastSeenSessionsAgo: 0, totalOccurrences: 4 }],
  },
  {
    category: 'Repeat offender (prepends "third session")',
    description: 'Deadlift rounded back — 6 recent sessions',
    exerciseId: 'deadlift',
    faultId: 'rounded_back',
    userHistory: [{ faultId: 'rounded_back', lastSeenSessionsAgo: 1, totalOccurrences: 6 }],
  },

  // Stale: 3+ occurrences but too long ago
  {
    category: 'Stale recurrence (no prefix)',
    description: 'Squat shallow depth — 4 occurrences but 5 sessions ago',
    exerciseId: 'squat',
    faultId: 'shallow_depth',
    userHistory: [{ faultId: 'shallow_depth', lastSeenSessionsAgo: 5, totalOccurrences: 4 }],
  },

  // Mid-tier: 1-2 occurrences → fixTip path
  {
    category: 'Mid-tier (uses fixTip[0])',
    description: 'Squat shallow depth — 1 occurrence',
    exerciseId: 'squat',
    faultId: 'shallow_depth',
    userHistory: [{ faultId: 'shallow_depth', lastSeenSessionsAgo: 0, totalOccurrences: 1 }],
  },
  {
    category: 'Mid-tier (uses fixTip[0])',
    description: 'Bench press elbow flare — 2 occurrences',
    exerciseId: 'benchpress',
    faultId: 'elbow_flare',
    userHistory: [{ faultId: 'elbow_flare', lastSeenSessionsAgo: 0, totalOccurrences: 2 }],
  },

  // Unknown fault fallback
  {
    category: 'Fallback',
    description: 'Unknown fault id',
    exerciseId: 'squat',
    faultId: 'nonexistent_fault',
  },
  {
    category: 'Fallback',
    description: 'Unknown exercise',
    exerciseId: 'nonexistent_exercise',
    faultId: 'shallow_depth',
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

async function generateReport(): Promise<string> {
  const lines: string[] = [];
  lines.push('# Personalized Cue Report');
  lines.push('');
  lines.push(
    'Deterministic output of `staticPersonalizedCueRunner` across canonical (exercise, fault, history) cases. Regenerate with `bun scripts/personalized-cue-report.ts`.',
  );
  lines.push('');
  lines.push(`- Total cases: **${CASES.length}**`);
  lines.push(`- Source: static (glossary lookup + history heuristic)`);
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
      const output = await staticPersonalizedCueRunner.getCue({
        exerciseId: c.exerciseId,
        faultId: c.faultId,
        userHistory: c.userHistory,
      });
      lines.push(`### ${c.description}`);
      lines.push('');
      lines.push(`- **Exercise × fault:** \`${c.exerciseId}\` · \`${c.faultId}\``);
      if (c.userHistory && c.userHistory.length > 0) {
        const h = c.userHistory[0]!;
        lines.push(
          `- **History:** ${h.totalOccurrences} occurrence${h.totalOccurrences === 1 ? '' : 's'}, last seen ${h.lastSeenSessionsAgo} session${h.lastSeenSessionsAgo === 1 ? '' : 's'} ago`,
        );
      } else {
        lines.push('- **History:** none');
      }
      lines.push('');
      lines.push(`> ${output.cue}`);
      lines.push('');
      lines.push(
        `- **References history:** ${output.referencesHistory ? 'yes' : 'no'}`,
      );
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
