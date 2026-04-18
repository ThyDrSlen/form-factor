/**
 * Generate a markdown report of voice-rpe-parser output across canonical
 * utterances that stress every code path in the parser. Commit the output
 * so `git diff docs/evals/voice-rpe-report.md` is a regression baseline.
 *
 * Run:
 *   bun scripts/voice-rpe-report.ts
 *   bun scripts/voice-rpe-report.ts --out docs/evals/voice-rpe-report.md
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseRpeUtterance } from '@/lib/services/voice-rpe-parser';

const DEFAULT_OUT = 'docs/evals/voice-rpe-report.md';

interface Case {
  category: string;
  description: string;
  utterance: string;
}

const CASES: Case[] = [
  { category: 'Digit', description: 'Clean digit only', utterance: '8' },
  { category: 'Digit', description: 'Digit with notes', utterance: '8 felt grindy on the last three' },
  { category: 'Digit', description: 'Digit out of range', utterance: '12' },
  { category: 'RPE prefix', description: 'rpe prefix', utterance: 'rpe 7' },
  { category: 'RPE prefix', description: 'uppercase rpe', utterance: 'RPE 9 last rep was brutal' },
  { category: 'Word', description: 'Single word', utterance: 'eight' },
  { category: 'Word', description: 'Word zero', utterance: 'zero' },
  { category: 'Range', description: 'Range with "maybe"', utterance: 'seven maybe eight' },
  { category: 'Range', description: 'Range with "or"', utterance: 'six or seven' },
  { category: 'Flag only', description: 'Grindy', utterance: 'that was grindy' },
  { category: 'Flag only', description: 'Brutal', utterance: 'absolutely brutal' },
  { category: 'Flag only', description: 'Easy', utterance: 'easy cake' },
  { category: 'Flag only', description: 'Failed', utterance: 'failed the last rep' },
  { category: 'Flag only', description: 'Breakdown', utterance: 'form broke on rep 4' },
  { category: 'Flag only', description: 'Paused', utterance: 'paused mid rep, couldn\'t recover' },
  { category: 'Flag only', description: 'Quick', utterance: 'that felt snappy today' },
  { category: 'Combination', description: 'Digit + multiple flags', utterance: '9, brutal, form broke on the last two' },
  { category: 'Combination', description: 'Word + flag', utterance: 'seven, felt grindy' },
  { category: 'Edge', description: 'Empty string', utterance: '' },
  { category: 'Edge', description: 'Whitespace only', utterance: '   ' },
  { category: 'Edge', description: 'Mixed case preserved', utterance: 'RPE Eight Felt GRINDY' },
  { category: 'Edge', description: 'Digit at end', utterance: 'I think maybe 7' },
  { category: 'Edge', description: 'Two separate digits', utterance: 'set 3 rep 9' },
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

function generateReport(): string {
  const lines: string[] = [];
  lines.push('# Voice RPE Parser Report');
  lines.push('');
  lines.push(
    'Deterministic output of `parseRpeUtterance` across canonical utterances that stress every parser path. Regenerate with `bun scripts/voice-rpe-report.ts`.',
  );
  lines.push('');
  lines.push(`- Total cases: **${CASES.length}**`);
  lines.push(`- Source: regex-only (no LLM yet)`);
  lines.push('');

  const byCategory = new Map<string, Case[]>();
  for (const c of CASES) {
    const bucket = byCategory.get(c.category) ?? [];
    bucket.push(c);
    byCategory.set(c.category, bucket);
  }

  for (const [category, cases] of [...byCategory.entries()].sort()) {
    lines.push(`## ${category}`);
    lines.push('');
    for (const c of cases) {
      const parsed = parseRpeUtterance(c.utterance);
      lines.push(`### ${c.description}`);
      lines.push('');
      lines.push(`- **Utterance:** \`${c.utterance || '(empty)'}\``);
      lines.push(`- **RPE:** ${parsed.rpe ?? '—'}`);
      lines.push(`- **Notes:** ${parsed.notes ? `"${parsed.notes}"` : '—'}`);
      lines.push(
        `- **Flags:** ${parsed.flags.length > 0 ? parsed.flags.map((f) => `\`${f}\``).join(', ') : '—'}`,
      );
      lines.push(`- **Confidence:** ${(parsed.confidence * 100).toFixed(0)}%`);
      lines.push(`- **Source:** \`${parsed.source}\``);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function main() {
  const { out } = parseArgs(process.argv.slice(2));
  const report = generateReport();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, report);
  console.log(`Wrote ${out}`);
  console.log(`  Cases evaluated: ${CASES.length}`);
}

main();
