import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pullupDefinition } from '../lib/workouts/pullup';
import type { PullupFixtureFrame } from '../lib/debug/pullup-fixture-corpus';

const ROOT = process.cwd();
const FIXTURE_DIR = join(ROOT, 'tests', 'fixtures', 'pullup-tracking');

function parseFixtureArg(): string | null {
  const raw = process.argv.find((arg) => arg.startsWith('--fixture='));
  return raw ? raw.split('=')[1] : null;
}

function loadFixture(fileName: string): PullupFixtureFrame[] {
  const filePath = join(FIXTURE_DIR, fileName);
  return JSON.parse(readFileSync(filePath, 'utf8')) as PullupFixtureFrame[];
}

function evaluate(frames: PullupFixtureFrame[]): {
  repCount: number;
  partialFrames: number;
  expectedRepCount: number;
  expectedPartialMin?: number;
  expectedPartialMax?: number;
  pass: boolean;
} {
  const expected = frames[0]?.expected ?? { repCount: 0 };
  let phase = pullupDefinition.initialPhase;
  let repCount = 0;
  let lastRepMs = Number.NEGATIVE_INFINITY;
  let partialFrames = 0;

  for (const frame of frames) {
    const joints = frame.joints
      ? new Map(Object.entries(frame.joints).map(([key, value]) => [key, { x: value.x, y: value.y, isTracked: value.isTracked }]))
      : undefined;
    const metrics = pullupDefinition.calculateMetrics(frame.angles, joints);
    const next = pullupDefinition.getNextPhase(phase, frame.angles, metrics);
    if (next === 'pull') {
      partialFrames += 1;
    }

    if (next !== phase) {
      if (next === pullupDefinition.repBoundary.endPhase && phase !== pullupDefinition.initialPhase) {
        const tsMs = frame.timestampSec * 1000;
        if (tsMs - lastRepMs > pullupDefinition.repBoundary.minDurationMs) {
          repCount += 1;
          lastRepMs = tsMs;
        }
      }
      phase = next;
    }
  }

  const partialMinPass =
    expected.partialFramesMin === undefined || partialFrames >= expected.partialFramesMin;
  const partialMaxPass =
    expected.partialFramesMax === undefined || partialFrames <= expected.partialFramesMax;

  return {
    repCount,
    partialFrames,
    expectedRepCount: expected.repCount,
    expectedPartialMin: expected.partialFramesMin,
    expectedPartialMax: expected.partialFramesMax,
    pass: repCount === expected.repCount && partialMinPass && partialMaxPass,
  };
}

function main(): void {
  const fixtureArg = parseFixtureArg();
  const route = fixtureArg
    ? `/(tabs)/scan-arkit?fixturePlayback=1&fixture=${fixtureArg}`
    : null;

  const fileNames = readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .filter((name) => (fixtureArg ? name === `${fixtureArg}.json` : true));

  if (fileNames.length === 0) {
    throw new Error(`No fixtures found for selection: ${fixtureArg ?? 'all'}`);
  }

  if (route) {
    console.log(`[playback-route] ${route}`);
  }

  let allPass = true;

  for (const fileName of fileNames) {
    const frames = loadFixture(fileName);
    const summary = evaluate(frames);
    allPass = allPass && summary.pass;
    console.log(
      `${fileName} pass=${summary.pass} frames=${frames.length} repCount=${summary.repCount}/${summary.expectedRepCount} partialFrames=${summary.partialFrames} expectedPartial=${summary.expectedPartialMin ?? '-'}..${summary.expectedPartialMax ?? '-'}`,
    );
    if (fixtureArg) {
      console.log(`playbackFrames=${frames.length}`);
    }
  }

  if (!allPass) {
    process.exitCode = 1;
  }
}

main();
