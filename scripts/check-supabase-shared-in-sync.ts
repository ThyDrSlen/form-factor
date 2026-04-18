/**
 * Enforces that files in `supabase/functions/_shared/` that mirror
 * canonical `lib/services/` modules remain byte-identical. Run before
 * push so prompt drift between the RN-side library and the Deno-side
 * Edge Function never slips into production.
 *
 * Wired into `bun run ci:local`.
 *
 * Add new mirrored pairs to MIRROR_PAIRS below.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

interface MirrorPair {
  canonical: string;
  mirror: string;
  note: string;
}

const MIRROR_PAIRS: MirrorPair[] = [
  {
    canonical: 'lib/services/fault-synthesis-prompt.ts',
    mirror: 'supabase/functions/_shared/fault-synthesis-prompt.ts',
    note:
      'SYSTEM_INSTRUCTION + buildFaultSynthesisUserPrompt — must match exactly ' +
      'so client-side snapshot tests cover the server-side prompt too.',
  },
];

interface DriftReport {
  pair: MirrorPair;
  kind: 'missing-canonical' | 'missing-mirror' | 'content-mismatch';
  detail: string;
}

function compare(pair: MirrorPair): DriftReport | null {
  const canonicalPath = resolve(process.cwd(), pair.canonical);
  const mirrorPath = resolve(process.cwd(), pair.mirror);

  if (!existsSync(canonicalPath)) {
    return { pair, kind: 'missing-canonical', detail: `${pair.canonical} not found` };
  }
  if (!existsSync(mirrorPath)) {
    return { pair, kind: 'missing-mirror', detail: `${pair.mirror} not found` };
  }

  const canonical = readFileSync(canonicalPath, 'utf8');
  const mirror = readFileSync(mirrorPath, 'utf8');
  if (canonical === mirror) return null;

  const canonicalLines = canonical.split('\n');
  const mirrorLines = mirror.split('\n');
  let firstDiff = -1;
  const min = Math.min(canonicalLines.length, mirrorLines.length);
  for (let i = 0; i < min; i += 1) {
    if (canonicalLines[i] !== mirrorLines[i]) {
      firstDiff = i + 1;
      break;
    }
  }
  if (firstDiff === -1) firstDiff = min + 1;

  return {
    pair,
    kind: 'content-mismatch',
    detail: `first divergent line: ${firstDiff} (canonical has ${canonicalLines.length} lines, mirror has ${mirrorLines.length})`,
  };
}

function main(): number {
  const drift = MIRROR_PAIRS.map(compare).filter((r): r is DriftReport => r !== null);
  if (drift.length === 0) {
    console.log(
      `✓ ${MIRROR_PAIRS.length} shared module${MIRROR_PAIRS.length === 1 ? '' : 's'} in sync.`,
    );
    return 0;
  }

  console.error('\n✗ Supabase _shared drift detected:\n');
  for (const report of drift) {
    console.error(`  • ${report.pair.canonical}`);
    console.error(`      ↔ ${report.pair.mirror}`);
    console.error(`      ${report.kind}: ${report.detail}`);
    console.error(`      (${report.pair.note})`);
    console.error('');
  }
  console.error(
    'Fix: copy the canonical file over the mirror, or vice versa, so both are byte-identical.',
  );
  return 1;
}

process.exit(main());
