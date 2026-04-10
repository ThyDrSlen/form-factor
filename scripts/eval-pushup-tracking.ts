/**
 * Minimal push-up tracking evaluator.
 *
 * Loads push-up fixture JSON from tests/fixtures/pushup-tracking/,
 * runs RepDetectorPullup with pushup-appropriate elbow threshold overrides,
 * and reports rep count vs expected.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PushupFixtureFrame } from '../lib/debug/pushup-fixture-corpus';
import { PUSHUP_THRESHOLDS } from '../lib/workouts/pushup';
import { RepDetectorPullup } from '../lib/tracking-quality/rep-detector';

type TraceResult = {
  trace: string;
  frames: number;
  expected: number;
  detected: number;
  error: number;
  pass: boolean;
};

function parseFixturesDir(argv: string[]): string {
  const cwd = process.cwd();
  const defaultDir = join(cwd, 'tests', 'fixtures', 'pushup-tracking');
  const dirArg = argv.find((arg) => arg.startsWith('--fixtures='));
  return resolve(dirArg ? dirArg.split('=')[1] : defaultDir);
}

function loadFixture(filePath: string): PushupFixtureFrame[] {
  const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`fixture must be a non-empty array: ${filePath}`);
  }
  return parsed as PushupFixtureFrame[];
}

function evaluateTrace(frames: PushupFixtureFrame[]): number {
  // Map pushup thresholds onto RepDetectorPullup options:
  //   elbowBottomDeg -> readyElbow (155) -- arms straight = "bottom" for the detector (rest position)
  //   elbowEngageDeg -> loweringStart (140) -- start bending = detector "ascending" trigger
  //   elbowTopDeg    -> bottom (90) -- deepest bend = detector "top" position
  //
  // The detector's shoulder-hand gap logic also contributes. For push-ups
  // the shoulder Y moves DOWN when lowering (gap decreases), which is the
  // opposite direction from pull-ups. We use very small lift deltas so the
  // gap signal doesn't gate transitions -- elbow angles drive everything.
  const detector = new RepDetectorPullup({
    elbowBottomDeg: PUSHUP_THRESHOLDS.readyElbow,   // 155 -- arms locked = "bottom" in detector
    elbowEngageDeg: PUSHUP_THRESHOLDS.loweringStart, // 140 -- begin descent
    elbowTopDeg: PUSHUP_THRESHOLDS.bottom,           // 90  -- full depth = detector "top"
    // Effectively disable shoulder-hand gap gating by using tiny deltas
    // Push-up shoulder movement is small and in the opposite direction
    liftStartDelta: 0.005,
    liftTopDelta: 0.01,
    liftTopExitDelta: 0.008,
    liftBottomDelta: 0.003,
    nConsecFrames: 2,
  });

  for (const frame of frames) {
    const joints = frame.joints
      ? new Map(
          Object.entries(frame.joints).map(([key, value]) => [
            key,
            { x: value.x, y: value.y, isTracked: value.isTracked, confidence: value.confidence },
          ]),
        )
      : undefined;

    detector.step({
      timestampSec: frame.timestampSec,
      angles: frame.angles,
      joints,
    });
  }

  return detector.getSnapshot().repCount;
}

function main(): void {
  const fixturesDir = parseFixturesDir(process.argv.slice(2));

  if (!existsSync(fixturesDir)) {
    console.error(`fixtures not found: ${fixturesDir}`);
    process.exit(1);
  }

  const files = readdirSync(fixturesDir)
    .filter((name) => name.endsWith('.json'))
    .sort();

  if (files.length === 0) {
    console.error(`no fixture files found in ${fixturesDir}`);
    process.exit(1);
  }

  const results: TraceResult[] = [];

  for (const fileName of files) {
    const traceName = fileName.replace(/\.json$/, '');
    const filePath = join(fixturesDir, fileName);
    const frames = loadFixture(filePath);
    const expected = frames[0]?.expected?.repCount ?? 0;
    const detected = evaluateTrace(frames);
    const error = Math.abs(detected - expected);

    results.push({
      trace: traceName,
      frames: frames.length,
      expected,
      detected,
      error,
      pass: error <= 1,
    });
  }

  console.log('');
  console.log('Push-up Tracking Evaluation');
  console.log('===========================');
  console.log('');
  console.log(`${'trace'.padEnd(20)} ${'frames'.padStart(6)} ${'expected'.padStart(8)} ${'detected'.padStart(8)} ${'error'.padStart(5)} ${'result'.padStart(6)}`);
  console.log('-'.repeat(60));

  for (const r of results) {
    const status = r.pass ? 'PASS' : 'FAIL';
    console.log(
      `${r.trace.padEnd(20)} ${String(r.frames).padStart(6)} ${String(r.expected).padStart(8)} ${String(r.detected).padStart(8)} ${String(r.error).padStart(5)} ${status.padStart(6)}`,
    );
  }

  console.log('-'.repeat(60));
  const passCount = results.filter((r) => r.pass).length;
  console.log(`${passCount}/${results.length} traces within +/-1 rep accuracy`);
  console.log('');

  if (!results.every((r) => r.pass)) {
    process.exitCode = 1;
  }
}

main();
