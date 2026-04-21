#!/usr/bin/env bun
/**
 * generate-cue-audio.ts
 *
 * Extracts all cue strings from workout definitions and generates MP3 files
 * via the ElevenLabs TTS API.
 *
 * Usage:
 *   bun scripts/generate-cue-audio.ts            # Generate all cue audio files
 *   bun scripts/generate-cue-audio.ts --dry-run   # List cues without calling API
 *
 * Requires: ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID
 */

import { generateCueFile } from '@/lib/services/elevenlabs-node';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { pullupDefinition } from '@/lib/workouts/pullup';
import { squatDefinition } from '@/lib/workouts/squat';
import { pushupDefinition } from '@/lib/workouts/pushup';
import { deadliftDefinition } from '@/lib/workouts/deadlift';
import { rdlDefinition } from '@/lib/workouts/rdl';
import { benchpressDefinition } from '@/lib/workouts/benchpress';
import { deadHangDefinition } from '@/lib/workouts/dead-hang';
import { farmersWalkDefinition } from '@/lib/workouts/farmers-walk';

const ALL_DEFINITIONS = [
  pullupDefinition,
  squatDefinition,
  pushupDefinition,
  deadliftDefinition,
  rdlDefinition,
  benchpressDefinition,
  deadHangDefinition,
  farmersWalkDefinition,
] as const;

const REINFORCEMENT_CUES = [
  'Strong reps — keep it up.',
  'Great form — stay focused.',
  'Nice work — keep the tempo smooth.',
  'Looking good — maintain that range.',
  'Solid rep — keep going.',
];

function extractAllCues(): string[] {
  const cueSet = new Set<string>();

  for (const definition of ALL_DEFINITIONS) {
    for (const phase of definition.phases) {
      if (phase.staticCue) {
        cueSet.add(phase.staticCue);
      }
    }

    for (const fault of definition.faults) {
      if (fault.dynamicCue) {
        cueSet.add(fault.dynamicCue);
      }
    }
  }

  for (const cue of REINFORCEMENT_CUES) {
    cueSet.add(cue);
  }

  return Array.from(cueSet).sort();
}

function cueToFilename(text: string): string {
  const hash = createHash('md5').update(text).digest('hex').slice(0, 12);
  return `${hash}.mp3`;
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  const cues = extractAllCues();

  if (isDryRun) {
    console.log(`Found ${cues.length} unique cues:\n`);
    for (const cue of cues) {
      console.log(`  - ${cue}`);
    }
    process.exit(0);
  }

  const outDir = join(process.cwd(), 'assets', 'audio', 'cues');
  mkdirSync(outDir, { recursive: true });

  const manifest: Record<string, string> = {};
  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const cue of cues) {
    const filename = cueToFilename(cue);
    const filePath = join(outDir, filename);
    manifest[cue] = filename;

    if (existsSync(filePath)) {
      skipped++;
      continue;
    }

    console.log(`Generating: "${cue}" → ${filename}`);
    const ok = await generateCueFile(cue, filePath);
    if (ok) {
      generated++;
    } else {
      console.error(`  ✗ Failed to generate: "${cue}"`);
      failed++;
    }
  }

  const manifestPath = join(outDir, 'cue-manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  console.log(
    `\nDone. Generated ${generated}/${cues.length} cues (${skipped} skipped${failed > 0 ? `, ${failed} failed` : ''}).`,
  );
  console.log(`Manifest written to ${manifestPath}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
