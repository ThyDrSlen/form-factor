import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pullupDefinition } from '../lib/workouts/pullup';
import { getPhaseStaticCue } from '../lib/workouts/helpers';
import { createRealtimeFormEngineState, processRealtimeAngles } from '../lib/pose/realtime-form-engine';
import type { PullupFixtureFrame } from '../lib/debug/pullup-fixture-corpus';
import type { PullUpPhase } from '../lib/workouts/pullup';

type CliArgs = {
  fixturesDir: string;
};

type TraceBaseline = {
  trace: string;
  frames: number;
  expected_rep_count: number;
  rep_count: number;
  partial_frame_percent: number;
  cue_flip_rate: number;
  mean_frame_latency_ms: number;
  frame_latency_buckets: {
    lt4: number;
    lt8: number;
    lt16: number;
    gte16: number;
  };
};

function parseArgs(argv: string[]): CliArgs {
  const cwd = process.cwd();
  const defaultDir = join(cwd, 'tests', 'fixtures', 'pullup-tracking');
  const fixturesArg = argv.find((arg) => arg.startsWith('--fixtures='));
  return {
    fixturesDir: resolve(fixturesArg ? fixturesArg.split('=')[1] : defaultDir),
  };
}

function loadFixture(filePath: string): PullupFixtureFrame[] {
  return JSON.parse(readFileSync(filePath, 'utf8')) as PullupFixtureFrame[];
}

function inferValidity(frame: PullupFixtureFrame): Record<keyof PullupFixtureFrame['angles'], boolean> {
  return {
    leftKnee: Number.isFinite(frame.angles.leftKnee),
    rightKnee: Number.isFinite(frame.angles.rightKnee),
    leftElbow: Number.isFinite(frame.angles.leftElbow),
    rightElbow: Number.isFinite(frame.angles.rightElbow),
    leftHip: Number.isFinite(frame.angles.leftHip),
    rightHip: Number.isFinite(frame.angles.rightHip),
    leftShoulder: Number.isFinite(frame.angles.leftShoulder),
    rightShoulder: Number.isFinite(frame.angles.rightShoulder),
  };
}

function evaluateTrace(traceName: string, frames: PullupFixtureFrame[]): TraceBaseline {
  const expectedRepCount = frames[0]?.expected?.repCount ?? 0;
  const engineState = createRealtimeFormEngineState();
  let phase: PullUpPhase = pullupDefinition.initialPhase;
  let repCount = 0;
  let partialFrames = 0;
  let lastRepTimestampMs = Number.NEGATIVE_INFINITY;
  let lastCue: string | null = null;
  let cueFlipCount = 0;
  let cueSamples = 0;
  let frameLatencyTotalMs = 0;
  const latencyBuckets = { lt4: 0, lt8: 0, lt16: 0, gte16: 0 };

  for (const frame of frames) {
    const frameStartNs = process.hrtime.bigint();

    const smoothed = processRealtimeAngles({
      state: engineState,
      angles: frame.angles,
      valid: inferValidity(frame),
      timestampSec: frame.timestampSec,
    });

    const joints = frame.joints
      ? new Map(
          Object.entries(frame.joints).map(([key, value]) => [
            key,
            { x: value.x, y: value.y, isTracked: value.isTracked },
          ]),
        )
      : undefined;
    const metrics = pullupDefinition.calculateMetrics(smoothed.angles, joints);
    const nextPhase = pullupDefinition.getNextPhase(phase, smoothed.angles, metrics);

    if (nextPhase === 'pull') {
      partialFrames += 1;
    }

    if (nextPhase !== phase) {
      if (nextPhase === pullupDefinition.repBoundary.endPhase && phase !== pullupDefinition.initialPhase) {
        const tsMs = frame.timestampSec * 1000;
        if (tsMs - lastRepTimestampMs > pullupDefinition.repBoundary.minDurationMs) {
          repCount += 1;
          lastRepTimestampMs = tsMs;
        }
      }
      phase = nextPhase;
    }

    const phaseCue = getPhaseStaticCue(pullupDefinition, phase);
    const realtimeCues = pullupDefinition.ui?.getRealtimeCues?.({ phaseId: phase, metrics });
    const primaryCue = [phaseCue, ...(realtimeCues ?? [])].find((cue): cue is string => !!cue) ?? null;
    if (primaryCue) {
      cueSamples += 1;
      if (lastCue && lastCue !== primaryCue) {
        cueFlipCount += 1;
      }
      lastCue = primaryCue;
    } else {
      lastCue = null;
    }

    const frameLatencyMs = Number(process.hrtime.bigint() - frameStartNs) / 1e6;
    frameLatencyTotalMs += frameLatencyMs;
    if (frameLatencyMs < 4) {
      latencyBuckets.lt4 += 1;
    } else if (frameLatencyMs < 8) {
      latencyBuckets.lt8 += 1;
    } else if (frameLatencyMs < 16) {
      latencyBuckets.lt16 += 1;
    } else {
      latencyBuckets.gte16 += 1;
    }
  }

  const frameCount = frames.length;
  return {
    trace: traceName,
    frames: frameCount,
    expected_rep_count: expectedRepCount,
    rep_count: repCount,
    partial_frame_percent: frameCount > 0 ? (partialFrames / frameCount) * 100 : 0,
    cue_flip_rate: cueSamples > 0 ? cueFlipCount / cueSamples : 0,
    mean_frame_latency_ms: frameCount > 0 ? frameLatencyTotalMs / frameCount : 0,
    frame_latency_buckets: latencyBuckets,
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.fixturesDir)) {
    console.error(`fixtures not found: ${args.fixturesDir}`);
    process.exit(1);
  }

  const fixtureFiles = readdirSync(args.fixturesDir)
    .filter((name) => name.endsWith('.json'))
    .sort();

  if (fixtureFiles.length === 0) {
    console.error(`fixtures not found: ${args.fixturesDir}`);
    process.exit(1);
  }

  const traces = fixtureFiles.map((fileName) => {
    const traceName = fileName.replace(/\.json$/, '');
    const frames = loadFixture(join(args.fixturesDir, fileName));
    return evaluateTrace(traceName, frames);
  });

  const report = {
    fixture_dir: args.fixturesDir,
    traces,
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main();
