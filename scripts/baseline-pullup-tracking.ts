import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pullupDefinition } from '../lib/workouts/pullup';
import { getPhaseStaticCue } from '../lib/workouts/helpers';
import { createRealtimeFormEngineState, processRealtimeAngles } from '../lib/pose/realtime-form-engine';
import { CueHysteresisController } from '../lib/tracking-quality/cue-hysteresis';
import { HIDE_N_FRAMES, SHOW_N_FRAMES } from '../lib/tracking-quality/config';
import { HybridRepDetector } from '../lib/tracking-quality/hybrid-rep-detector';
import { RepDetectorPullup } from '../lib/tracking-quality/rep-detector';
import type { PullupFixtureFrame } from '../lib/debug/pullup-fixture-corpus';
import type { PullUpPhase } from '../lib/workouts/pullup';

type CliArgs = {
  fixturesDir: string;
  hysteresis: boolean;
};

type TraceBaseline = {
  trace: string;
  frames: number;
  expected_rep_count: number;
  rep_count: number;
  angle_only_rep_count: number;
  hybrid_rep_count: number;
  partial_frame_percent: number;
  cue_flip_rate: number;
  cue_flip_rate_frame_raw: number;
  cue_flip_rate_frame: number;
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
  const hysteresisArg = argv.find((arg) => arg === '--hysteresis' || arg.startsWith('--hysteresis='));
  const hysteresisValue = hysteresisArg?.includes('=') ? hysteresisArg.split('=')[1] : hysteresisArg ? '1' : undefined;
  const hysteresis = hysteresisValue === '1' || hysteresisValue === 'true' || hysteresisValue === 'yes' || hysteresisValue === 'on';
  return {
    fixturesDir: resolve(fixturesArg ? fixturesArg.split('=')[1] : defaultDir),
    hysteresis,
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

function computeTrackingQuality(frame: PullupFixtureFrame): number {
  if (!frame.joints) {
    return 0;
  }
  const entries = Object.values(frame.joints);
  if (entries.length === 0) {
    return 0;
  }
  const trackedCount = entries.filter((joint) => joint.isTracked).length;
  return trackedCount / entries.length;
}

function toJoints2D(
  frame: PullupFixtureFrame,
): Record<string, { x: number; y: number; isTracked: boolean }> {
  if (!frame.joints) {
    return {};
  }
  const result: Record<string, { x: number; y: number; isTracked: boolean }> = {};
  for (const [key, value] of Object.entries(frame.joints)) {
    result[key] = { x: value.x, y: value.y, isTracked: value.isTracked };
  }
  return result;
}

function evaluateTrace(traceName: string, frames: PullupFixtureFrame[], options: { hysteresis: boolean }): TraceBaseline {
  const expectedRepCount = frames[0]?.expected?.repCount ?? 0;
  const engineState = createRealtimeFormEngineState();
  let phase: PullUpPhase = pullupDefinition.initialPhase;
  let repCount = 0;
  let partialFrames = 0;
  let lastRepTimestampMs = Number.NEGATIVE_INFINITY;
  let lastCue: string | null = null;
  let cueFlipCount = 0;
  let cueSamples = 0;
  let seenFirstFrame = false;
  let lastFrameCueRaw: string | null = null;
  let lastFrameCueStable: string | null = null;
  let frameFlipCountRaw = 0;
  let frameFlipCountStable = 0;
  let frameFlipDenom = 0;
  let frameLatencyTotalMs = 0;
  const latencyBuckets = { lt4: 0, lt8: 0, lt16: 0, gte16: 0 };
  const cueHysteresis = options.hysteresis
    ? new CueHysteresisController<string>({ showFrames: SHOW_N_FRAMES, hideFrames: HIDE_N_FRAMES })
    : null;
  let stableCue: string | null = null;

  // Angle-only detector (RepDetectorPullup)
  const angleDetector = new RepDetectorPullup();
  let previousAngleState: ReturnType<RepDetectorPullup['getSnapshot']>['state'] = 'bottom';
  let previousAngleRepCount = 0;
  let framesSinceAngleRep = 0;

  // Hybrid detector
  const hybridDetector = new HybridRepDetector();

  /** Frames without an angle-based rep before we degrade tracking quality.
   *  At 30fps, 90 frames ~ 3 seconds stuck without completing a rep cycle. */
  const ANGLE_STALE_FRAMES = 90;

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
    // Joints with confidence for the angle-only and hybrid detectors
    const jointsWithConfidence = frame.joints
      ? new Map(
          Object.entries(frame.joints).map(([key, value]) => [
            key,
            { x: value.x, y: value.y, isTracked: value.isTracked, confidence: value.confidence },
          ]),
        )
      : undefined;
    const joints2D = toJoints2D(frame);
    const metrics = pullupDefinition.calculateMetrics(smoothed.angles, joints);
    const nextPhase = pullupDefinition.getNextPhase(phase, smoothed.angles, metrics);
    const tsMs = frame.timestampSec * 1000;
    const rawTrackingQuality = computeTrackingQuality(frame);

    if (nextPhase === 'pull') {
      partialFrames += 1;
    }

    if (nextPhase !== phase) {
      if (nextPhase === pullupDefinition.repBoundary.endPhase && phase !== pullupDefinition.initialPhase) {
        if (tsMs - lastRepTimestampMs > pullupDefinition.repBoundary.minDurationMs) {
          repCount += 1;
          lastRepTimestampMs = tsMs;
        }
      }
      phase = nextPhase;
    }

    // Step angle-only detector (uses confidence-aware joints for consistent results with eval script)
    angleDetector.step({
      timestampSec: frame.timestampSec,
      angles: smoothed.angles,
      joints: jointsWithConfidence,
    });
    const angleSnapshot = angleDetector.getSnapshot();

    // Track how long since the angle detector last produced a rep.
    if (angleSnapshot.repCount > previousAngleRepCount) {
      framesSinceAngleRep = 0;
      previousAngleRepCount = angleSnapshot.repCount;
    } else {
      framesSinceAngleRep += 1;
    }

    // Degrade quality when the angle detector has not produced any reps after
    // enough frames. This pushes the hybrid detector into medium/low quality
    // mode where vertical displacement can fire independently. This handles
    // scenarios like no-deadhang (stuck in descending), vertical-displacement
    // (stuck at bottom because gap is constant), and side-angle views.
    let trackingQuality = rawTrackingQuality;
    if (framesSinceAngleRep > ANGLE_STALE_FRAMES) {
      const staleFraction = Math.min(
        1,
        (framesSinceAngleRep - ANGLE_STALE_FRAMES) / ANGLE_STALE_FRAMES,
      );
      trackingQuality = rawTrackingQuality * (1 - staleFraction * 0.8);
    }

    // Compute phase transition for the hybrid detector
    let phaseTransition: { from: string; to: string } | undefined;
    if (angleSnapshot.state !== previousAngleState) {
      phaseTransition = { from: previousAngleState, to: angleSnapshot.state };
    }

    // Step hybrid detector
    hybridDetector.processFrame({
      angles: smoothed.angles,
      joints2D,
      trackingQuality,
      timestamp: tsMs,
      phaseTransition,
    });

    previousAngleState = angleSnapshot.state;

    const phaseCue = getPhaseStaticCue(pullupDefinition, phase);
    const realtimeCues = pullupDefinition.ui?.getRealtimeCues?.({ phaseId: phase, metrics });
    const orderedActiveCues = [phaseCue, ...(realtimeCues ?? [])].filter((cue): cue is string => !!cue);
    const rawPrimaryCue = orderedActiveCues[0] ?? null;
    const stablePrimaryCue = cueHysteresis
      ? (stableCue = cueHysteresis.nextStableCueFromOrderedActive({ orderedActiveCues, previousStableCue: stableCue }))
      : rawPrimaryCue;

    if (seenFirstFrame) {
      frameFlipDenom += 1;
      if (rawPrimaryCue !== lastFrameCueRaw) {
        frameFlipCountRaw += 1;
      }
      if (stablePrimaryCue !== lastFrameCueStable) {
        frameFlipCountStable += 1;
      }
    } else {
      seenFirstFrame = true;
    }
    lastFrameCueRaw = rawPrimaryCue;
    lastFrameCueStable = stablePrimaryCue;

    if (cueHysteresis) {
      if (!rawPrimaryCue) {
        lastCue = null;
      } else {
        cueSamples += 1;
        if (stablePrimaryCue && lastCue && lastCue !== stablePrimaryCue) {
          cueFlipCount += 1;
        }
        lastCue = stablePrimaryCue;
      }
    } else if (stablePrimaryCue) {
      cueSamples += 1;
      if (lastCue && lastCue !== stablePrimaryCue) {
        cueFlipCount += 1;
      }
      lastCue = stablePrimaryCue;
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
    angle_only_rep_count: angleDetector.getSnapshot().repCount,
    hybrid_rep_count: hybridDetector.getRepCount(),
    partial_frame_percent: frameCount > 0 ? (partialFrames / frameCount) * 100 : 0,
    cue_flip_rate: cueSamples > 0 ? cueFlipCount / cueSamples : 0,
    cue_flip_rate_frame_raw: frameFlipDenom > 0 ? frameFlipCountRaw / frameFlipDenom : 0,
    cue_flip_rate_frame: frameFlipDenom > 0 ? frameFlipCountStable / frameFlipDenom : 0,
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
    return evaluateTrace(traceName, frames, { hysteresis: args.hysteresis });
  });

  const report = {
    fixture_dir: args.fixturesDir,
    traces,
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main();
