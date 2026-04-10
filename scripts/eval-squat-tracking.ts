/**
 * Squat Tracking Evaluation
 *
 * Loads squat fixture JSON files, runs a simple knee/hip angle phase detector
 * using thresholds from lib/workouts/squat.ts, and reports rep count vs expected.
 *
 * Usage:
 *   bun run scripts/eval-squat-tracking.ts
 *   bun run scripts/eval-squat-tracking.ts --fixtures=path/to/dir
 *   bun run scripts/eval-squat-tracking.ts --fixture=camera-facing
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SquatFixtureFrame } from '../lib/debug/squat-fixture-corpus';
import { SQUAT_THRESHOLDS } from '../lib/workouts/squat';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

type CliArgs = {
  fixturesDir: string;
  fixture: string | null;
};

function parseArgs(argv: string[]): CliArgs {
  const cwd = process.cwd();
  const defaultDir = join(cwd, 'tests', 'fixtures', 'squat-tracking');
  const fixturesArg = argv.find((arg) => arg.startsWith('--fixtures='));
  const fixtureArg = argv.find((arg) => arg.startsWith('--fixture='));
  return {
    fixturesDir: resolve(fixturesArg ? fixturesArg.split('=')[1] : defaultDir),
    fixture: fixtureArg ? fixtureArg.split('=')[1] : null,
  };
}

// ---------------------------------------------------------------------------
// Fixture loader
// ---------------------------------------------------------------------------

function loadFixture(filePath: string): SquatFixtureFrame[] {
  const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`fixture must be a non-empty array: ${filePath}`);
  }
  return parsed as SquatFixtureFrame[];
}

// ---------------------------------------------------------------------------
// Simple knee/hip phase-based rep detector
// Uses the squat.ts thresholds directly:
//   standing >= 160  ->  descentStart <= 145  ->  bottom <= 95  ->  ascent >= 110  ->  finish >= 155
// For partial-ROM scenarios the bottom phase may not be reached, so we also
// count a rep if the detector sees descent then returns to finish without
// hitting the formal bottom threshold.
// ---------------------------------------------------------------------------

type SquatDetectorPhase = 'standing' | 'descent' | 'bottom' | 'ascent';

type DetectorState = {
  phase: SquatDetectorPhase;
  repCount: number;
  lastRepTsMs: number;
  minKneeInRep: number;
};

const MIN_REP_DURATION_MS = 600; // from squat.ts repBoundary.minDurationMs

function initDetector(): DetectorState {
  return {
    phase: 'standing',
    repCount: 0,
    lastRepTsMs: Number.NEGATIVE_INFINITY,
    minKneeInRep: 999,
  };
}

function stepDetector(state: DetectorState, frame: SquatFixtureFrame): void {
  const avgKnee = (frame.angles.leftKnee + frame.angles.rightKnee) / 2;
  const tsMs = frame.timestampSec * 1000;

  switch (state.phase) {
    case 'standing':
      if (avgKnee <= SQUAT_THRESHOLDS.descentStart) {
        state.phase = 'descent';
        state.minKneeInRep = avgKnee;
      }
      break;

    case 'descent':
      state.minKneeInRep = Math.min(state.minKneeInRep, avgKnee);
      if (avgKnee <= SQUAT_THRESHOLDS.parallel) {
        state.phase = 'bottom';
      } else if (avgKnee >= SQUAT_THRESHOLDS.finish) {
        // Came back up without reaching parallel -- still count if enough ROM
        if (
          state.minKneeInRep <= SQUAT_THRESHOLDS.descentStart - 10 &&
          tsMs - state.lastRepTsMs > MIN_REP_DURATION_MS
        ) {
          state.repCount += 1;
          state.lastRepTsMs = tsMs;
        }
        state.phase = 'standing';
        state.minKneeInRep = 999;
      }
      break;

    case 'bottom':
      state.minKneeInRep = Math.min(state.minKneeInRep, avgKnee);
      if (avgKnee >= SQUAT_THRESHOLDS.ascent) {
        state.phase = 'ascent';
      }
      break;

    case 'ascent':
      if (avgKnee >= SQUAT_THRESHOLDS.finish) {
        if (tsMs - state.lastRepTsMs > MIN_REP_DURATION_MS) {
          state.repCount += 1;
          state.lastRepTsMs = tsMs;
        }
        state.phase = 'standing';
        state.minKneeInRep = 999;
      } else if (avgKnee <= SQUAT_THRESHOLDS.parallel) {
        // Dropped back down before finishing (unlikely but handle it)
        state.phase = 'bottom';
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

type TraceResult = {
  trace: string;
  frames: number;
  expected: number;
  detected: number;
  error: number;
  pass: boolean;
};

function evaluateTrace(traceName: string, frames: SquatFixtureFrame[]): TraceResult {
  const expectedRepCount = frames[0]?.expected?.repCount ?? 0;
  const detector = initDetector();

  for (const frame of frames) {
    stepDetector(detector, frame);
  }

  const error = Math.abs(detector.repCount - expectedRepCount);
  return {
    trace: traceName,
    frames: frames.length,
    expected: expectedRepCount,
    detected: detector.repCount,
    error,
    pass: error <= 1,
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function printReport(results: TraceResult[]): void {
  console.log('');
  console.log('Squat Tracking Evaluation');
  console.log('='.repeat(70));
  console.log('');

  const colWidths = { trace: 16, frames: 7, expected: 9, detected: 9, error: 6, pass: 6 };
  const header =
    'trace'.padEnd(colWidths.trace) +
    'frames'.padStart(colWidths.frames) +
    'expected'.padStart(colWidths.expected) +
    'detected'.padStart(colWidths.detected) +
    'error'.padStart(colWidths.error) +
    'pass'.padStart(colWidths.pass);
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const r of results) {
    console.log(
      r.trace.padEnd(colWidths.trace) +
        String(r.frames).padStart(colWidths.frames) +
        String(r.expected).padStart(colWidths.expected) +
        String(r.detected).padStart(colWidths.detected) +
        String(r.error).padStart(colWidths.error) +
        (r.pass ? 'yes' : 'NO').padStart(colWidths.pass),
    );
  }

  console.log('');
  const allPass = results.every((r) => r.pass);
  const passCount = results.filter((r) => r.pass).length;
  console.log(`${passCount}/${results.length} traces within +/-1 rep accuracy`);

  if (!allPass) {
    console.log('');
    console.log('FAIL: some traces exceeded +/-1 rep tolerance');
    process.exitCode = 1;
  } else {
    console.log('PASS');
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(args.fixturesDir)) {
    console.error(`fixtures not found: ${args.fixturesDir}`);
    process.exit(1);
  }

  const fixtureFiles = readdirSync(args.fixturesDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .filter((name) => (args.fixture ? name === `${args.fixture}.json` || name === args.fixture : true));

  if (fixtureFiles.length === 0) {
    console.error(`no fixture files found in ${args.fixturesDir}`);
    process.exit(1);
  }

  const results = fixtureFiles.map((fileName) => {
    const traceName = fileName.replace(/\.json$/, '');
    const frames = loadFixture(join(args.fixturesDir, fileName));
    return evaluateTrace(traceName, frames);
  });

  printReport(results);
}

main();
