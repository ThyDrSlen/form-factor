import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PullupFixtureFrame } from '../lib/debug/pullup-fixture-corpus';
import { createRealtimeFormEngineState, processRealtimeAngles } from '../lib/pose/realtime-form-engine';
import { HIDE_N_FRAMES, SHOW_N_FRAMES } from '../lib/tracking-quality/config';
import { RepDetectorPullup } from '../lib/tracking-quality/rep-detector';
import { scorePullupWithComponentAvailability } from '../lib/tracking-quality/scoring';
import { CueHysteresisController } from '../lib/tracking-quality/cue-hysteresis';
import { getPhaseStaticCue } from '../lib/workouts/helpers';
import { pullupDefinition, type PullUpPhase } from '../lib/workouts/pullup';

type CliArgs = {
  fixturesDir: string;
  fixture: string | null;
  format: 'both' | 'json' | 'markdown';
};

type TraceMetrics = {
  rep_count: number;
  partial_percent: number;
  cue_flip_rate: number;
  mean_overall_score: number | null;
  visibility_partial_rate: number;
  latency_summary: {
    mean_frame_interval_ms: number;
    p95_frame_interval_ms: number;
  };
};

type TraceResult = {
  trace: string;
  frames: number;
  expected_rep_count: number;
  before: TraceMetrics;
  after: TraceMetrics;
  rep_error_before: number;
  rep_error_after: number;
  within_accuracy_target: boolean;
};

type Report = {
  fixture_dir: string;
  traces: TraceResult[];
  aggregate: {
    traces: number;
    within_accuracy_target: number;
    before_mean_rep_error: number;
    after_mean_rep_error: number;
    before_mean_partial_percent: number;
    after_mean_partial_percent: number;
    before_mean_cue_flip_rate: number;
    after_mean_cue_flip_rate: number;
    before_mean_overall_score: number | null;
    after_mean_overall_score: number | null;
  };
};

class FixtureParseError extends Error {}

const ANGLE_KEYS: (keyof PullupFixtureFrame['angles'])[] = [
  'leftKnee',
  'rightKnee',
  'leftElbow',
  'rightElbow',
  'leftHip',
  'rightHip',
  'leftShoulder',
  'rightShoulder',
];

function parseArgs(argv: string[]): CliArgs {
  const cwd = process.cwd();
  const defaultDir = join(cwd, 'tests', 'fixtures', 'pullup-tracking');
  const fixturesArg = argv.find((arg) => arg.startsWith('--fixtures='));
  const fixtureArg = argv.find((arg) => arg.startsWith('--fixture='));
  const formatArg = argv.find((arg) => arg.startsWith('--format='));
  const format = (formatArg?.split('=')[1] ?? 'both').toLowerCase();
  const parsedFormat: CliArgs['format'] =
    format === 'json' || format === 'markdown' || format === 'both' ? format : 'both';

  return {
    fixturesDir: resolve(fixturesArg ? fixturesArg.split('=')[1] : defaultDir),
    fixture: fixtureArg ? fixtureArg.split('=')[1] : null,
    format: parsedFormat,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function assertFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new FixtureParseError(`parse error: ${label} must be a finite number`);
  }
  return value;
}

function validateFrame(rawFrame: unknown, frameIndex: number): PullupFixtureFrame {
  const frame = asRecord(rawFrame);
  if (!frame) {
    throw new FixtureParseError(`parse error: frame[${frameIndex}] must be an object`);
  }

  const timestampSec = assertFiniteNumber(frame.timestampSec, `frame[${frameIndex}].timestampSec`);
  const anglesRecord = asRecord(frame.angles);
  if (!anglesRecord) {
    throw new FixtureParseError(`parse error: frame[${frameIndex}].angles must be an object`);
  }

  const angles = {} as PullupFixtureFrame['angles'];
  for (const key of ANGLE_KEYS) {
    angles[key] = assertFiniteNumber(anglesRecord[key], `frame[${frameIndex}].angles.${String(key)}`);
  }

  let joints: PullupFixtureFrame['joints'] | undefined;
  if (frame.joints !== undefined) {
    const jointsRecord = asRecord(frame.joints);
    if (!jointsRecord) {
      throw new FixtureParseError(`parse error: frame[${frameIndex}].joints must be an object when present`);
    }
    const parsedJoints: NonNullable<PullupFixtureFrame['joints']> = {};
    for (const [jointKey, rawJoint] of Object.entries(jointsRecord)) {
      const joint = asRecord(rawJoint);
      if (!joint) {
        throw new FixtureParseError(`parse error: frame[${frameIndex}].joints.${jointKey} must be an object`);
      }
      parsedJoints[jointKey] = {
        x: assertFiniteNumber(joint.x, `frame[${frameIndex}].joints.${jointKey}.x`),
        y: assertFiniteNumber(joint.y, `frame[${frameIndex}].joints.${jointKey}.y`),
        isTracked:
          typeof joint.isTracked === 'boolean'
            ? joint.isTracked
            : (() => {
                throw new FixtureParseError(
                  `parse error: frame[${frameIndex}].joints.${jointKey}.isTracked must be a boolean`,
                );
              })(),
        confidence:
          joint.confidence === undefined
            ? undefined
            : assertFiniteNumber(joint.confidence, `frame[${frameIndex}].joints.${jointKey}.confidence`),
      };
    }
    joints = parsedJoints;
  }

  const expectedRecord = asRecord(frame.expected);
  if (!expectedRecord) {
    throw new FixtureParseError(`parse error: frame[${frameIndex}].expected must be an object`);
  }
  const expected: PullupFixtureFrame['expected'] = {
    repCount: Math.round(assertFiniteNumber(expectedRecord.repCount, `frame[${frameIndex}].expected.repCount`)),
    partialFramesMin:
      expectedRecord.partialFramesMin === undefined
        ? undefined
        : Math.round(
            assertFiniteNumber(expectedRecord.partialFramesMin, `frame[${frameIndex}].expected.partialFramesMin`),
          ),
    partialFramesMax:
      expectedRecord.partialFramesMax === undefined
        ? undefined
        : Math.round(
            assertFiniteNumber(expectedRecord.partialFramesMax, `frame[${frameIndex}].expected.partialFramesMax`),
          ),
  };

  return {
    timestampSec,
    angles,
    joints,
    expected,
  };
}

function loadFixture(filePath: string): PullupFixtureFrame[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new FixtureParseError(`parse error: failed to parse JSON in ${filePath}: ${(error as Error).message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new FixtureParseError(`parse error: fixture must be an array in ${filePath}`);
  }
  if (parsed.length === 0) {
    throw new FixtureParseError(`parse error: fixture must contain at least one frame in ${filePath}`);
  }

  const frames = parsed.map((frame, index) => validateFrame(frame, index));
  return frames;
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

function toJointMap(
  frame: PullupFixtureFrame,
): Map<string, { x: number; y: number; isTracked: boolean; confidence?: number }> | undefined {
  if (!frame.joints) {
    return undefined;
  }
  return new Map(
    Object.entries(frame.joints).map(([key, value]) => [
      key,
      { x: value.x, y: value.y, isTracked: value.isTracked, confidence: value.confidence },
    ]),
  );
}

function percentile95(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[idx] ?? sorted[sorted.length - 1] ?? 0;
}

function buildLatencySummary(frames: PullupFixtureFrame[]): TraceMetrics['latency_summary'] {
  if (frames.length <= 1) {
    return { mean_frame_interval_ms: 0, p95_frame_interval_ms: 0 };
  }
  const intervals = frames
    .slice(1)
    .map((frame, idx) => Math.max(0, (frame.timestampSec - frames[idx].timestampSec) * 1000));
  const mean = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
  return {
    mean_frame_interval_ms: mean,
    p95_frame_interval_ms: percentile95(intervals),
  };
}

type RepAccum = {
  startTsMs: number;
  endTsMs: number;
  start: PullupFixtureFrame['angles'];
  min: PullupFixtureFrame['angles'];
  max: PullupFixtureFrame['angles'];
  lastJoints?: Map<string, { x: number; y: number; isTracked: boolean; confidence?: number }>;
};

function cloneAngles(angles: PullupFixtureFrame['angles']): PullupFixtureFrame['angles'] {
  return { ...angles };
}

function startRepAccum(
  angles: PullupFixtureFrame['angles'],
  tsMs: number,
  joints?: Map<string, { x: number; y: number; isTracked: boolean; confidence?: number }>,
): RepAccum {
  const seeded = cloneAngles(angles);
  return {
    startTsMs: tsMs,
    endTsMs: tsMs,
    start: seeded,
    min: seeded,
    max: seeded,
    lastJoints: joints,
  };
}

function updateRepAccum(
  accum: RepAccum,
  angles: PullupFixtureFrame['angles'],
  tsMs: number,
  joints?: Map<string, { x: number; y: number; isTracked: boolean; confidence?: number }>,
): void {
  accum.endTsMs = tsMs;
  for (const key of ANGLE_KEYS) {
    accum.min[key] = Math.min(accum.min[key], angles[key]);
    accum.max[key] = Math.max(accum.max[key], angles[key]);
  }
  if (joints) {
    accum.lastJoints = joints;
  }
}

function scoreRep(accum: RepAccum): { overall: number | null; visibilityPartial: boolean } {
  const scored = scorePullupWithComponentAvailability({
    durationMs: Math.max(0, accum.endTsMs - accum.startTsMs),
    repAngles: {
      start: {
        leftElbow: accum.start.leftElbow,
        rightElbow: accum.start.rightElbow,
        leftShoulder: accum.start.leftShoulder,
        rightShoulder: accum.start.rightShoulder,
      },
      end: {
        leftElbow: accum.max.leftElbow,
        rightElbow: accum.max.rightElbow,
        leftShoulder: accum.max.leftShoulder,
        rightShoulder: accum.max.rightShoulder,
      },
      min: {
        leftElbow: accum.min.leftElbow,
        rightElbow: accum.min.rightElbow,
        leftShoulder: accum.min.leftShoulder,
        rightShoulder: accum.min.rightShoulder,
      },
      max: {
        leftElbow: accum.max.leftElbow,
        rightElbow: accum.max.rightElbow,
        leftShoulder: accum.max.leftShoulder,
        rightShoulder: accum.max.rightShoulder,
      },
    },
    joints: accum.lastJoints,
  });
  return {
    overall: scored.overall_score,
    visibilityPartial: scored.visibility_badge === 'partial',
  };
}

function mapDetectorStateToPhase(state: ReturnType<RepDetectorPullup['getSnapshot']>['state']): PullUpPhase {
  if (state === 'ascending') return 'pull';
  if (state === 'top') return 'top';
  if (state === 'descending') return 'hang';
  return 'hang';
}

function evaluateLegacy(frames: PullupFixtureFrame[]): TraceMetrics {
  const engineState = createRealtimeFormEngineState();
  let phase: PullUpPhase = pullupDefinition.initialPhase;
  let repCount = 0;
  let partialFrames = 0;
  let lastRepTimestampMs = Number.NEGATIVE_INFINITY;
  let lastCue: string | null = null;
  let cueFlipCount = 0;
  let cueSamples = 0;
  let repAccum: RepAccum | null = null;
  const scoredReps: number[] = [];
  let visibilityPartialCount = 0;

  for (const frame of frames) {
    const smoothed = processRealtimeAngles({
      state: engineState,
      angles: frame.angles,
      valid: inferValidity(frame),
      timestampSec: frame.timestampSec,
    });
    const joints = toJointMap(frame);
    const metrics = pullupDefinition.calculateMetrics(smoothed.angles, joints);
    const nextPhase = pullupDefinition.getNextPhase(phase, smoothed.angles, metrics);
    const tsMs = frame.timestampSec * 1000;

    if (nextPhase === pullupDefinition.repBoundary.startPhase && phase !== pullupDefinition.repBoundary.startPhase) {
      repAccum = startRepAccum(smoothed.angles, tsMs, joints);
    }
    if (repAccum) {
      updateRepAccum(repAccum, smoothed.angles, tsMs, joints);
    }

    if (nextPhase === 'pull') {
      partialFrames += 1;
    }

    const phaseCue = getPhaseStaticCue(pullupDefinition, nextPhase);
    const realtimeCues = pullupDefinition.ui?.getRealtimeCues?.({ phaseId: nextPhase, metrics }) ?? [];
    const primaryCue = [phaseCue, ...realtimeCues].find((cue): cue is string => typeof cue === 'string') ?? null;
    if (primaryCue) {
      cueSamples += 1;
      if (lastCue && lastCue !== primaryCue) {
        cueFlipCount += 1;
      }
      lastCue = primaryCue;
    } else {
      lastCue = null;
    }

    if (nextPhase !== phase) {
      if (nextPhase === pullupDefinition.repBoundary.endPhase && phase !== pullupDefinition.initialPhase) {
        if (tsMs - lastRepTimestampMs > pullupDefinition.repBoundary.minDurationMs) {
          repCount += 1;
          lastRepTimestampMs = tsMs;
          if (repAccum) {
            const scored = scoreRep(repAccum);
            if (typeof scored.overall === 'number') {
              scoredReps.push(scored.overall);
            }
            if (scored.visibilityPartial) {
              visibilityPartialCount += 1;
            }
          }
          repAccum = null;
        }
      }
      phase = nextPhase;
    }
  }

  return {
    rep_count: repCount,
    partial_percent: frames.length > 0 ? (partialFrames / frames.length) * 100 : 0,
    cue_flip_rate: cueSamples > 0 ? cueFlipCount / cueSamples : 0,
    mean_overall_score:
      scoredReps.length > 0 ? scoredReps.reduce((sum, value) => sum + value, 0) / scoredReps.length : null,
    visibility_partial_rate: repCount > 0 ? visibilityPartialCount / repCount : 0,
    latency_summary: buildLatencySummary(frames),
  };
}

function evaluateAfter(frames: PullupFixtureFrame[]): TraceMetrics {
  const engineState = createRealtimeFormEngineState();
  const detector = new RepDetectorPullup();
  const cueHysteresis = new CueHysteresisController<string>({ showFrames: SHOW_N_FRAMES, hideFrames: HIDE_N_FRAMES });
  let stableCue: string | null = null;
  let partialFrames = 0;
  let lastCue: string | null = null;
  let cueFlipCount = 0;
  let cueSamples = 0;
  let repAccum: RepAccum | null = null;
  let previousState: ReturnType<RepDetectorPullup['getSnapshot']>['state'] = 'bottom';
  let previousRepCount = 0;
  const scoredReps: number[] = [];
  let visibilityPartialCount = 0;

  for (const frame of frames) {
    const smoothed = processRealtimeAngles({
      state: engineState,
      angles: frame.angles,
      valid: inferValidity(frame),
      timestampSec: frame.timestampSec,
    });
    const joints = toJointMap(frame);
    const metrics = pullupDefinition.calculateMetrics(smoothed.angles, joints);
    const tsMs = frame.timestampSec * 1000;

    detector.step({
      timestampSec: frame.timestampSec,
      angles: smoothed.angles,
      joints,
    });
    const snapshot = detector.getSnapshot();
    const mappedPhase = mapDetectorStateToPhase(snapshot.state);
    if (snapshot.state !== 'bottom') {
      partialFrames += 1;
    }

    const phaseCue = getPhaseStaticCue(pullupDefinition, mappedPhase);
    const realtimeCues = pullupDefinition.ui?.getRealtimeCues?.({ phaseId: mappedPhase, metrics }) ?? [];
    const orderedActiveCues = [phaseCue, ...realtimeCues].filter((cue): cue is string => typeof cue === 'string');
    const stablePrimaryCue = (stableCue = cueHysteresis.nextStableCueFromOrderedActive({
      orderedActiveCues,
      previousStableCue: stableCue,
    }));

    if (stablePrimaryCue) {
      cueSamples += 1;
      if (lastCue && lastCue !== stablePrimaryCue) {
        cueFlipCount += 1;
      }
      lastCue = stablePrimaryCue;
    } else {
      lastCue = null;
    }

    if (previousState === 'bottom' && snapshot.state !== 'bottom') {
      repAccum = startRepAccum(smoothed.angles, tsMs, joints);
    }
    if (repAccum) {
      updateRepAccum(repAccum, smoothed.angles, tsMs, joints);
    }

    if (snapshot.repCount > previousRepCount) {
      if (repAccum) {
        const scored = scoreRep(repAccum);
        if (typeof scored.overall === 'number') {
          scoredReps.push(scored.overall);
        }
        if (scored.visibilityPartial) {
          visibilityPartialCount += 1;
        }
      }
      repAccum = null;
    }
    if (snapshot.state === 'bottom' && previousState !== 'bottom' && snapshot.repCount === previousRepCount) {
      repAccum = null;
    }

    previousState = snapshot.state;
    previousRepCount = snapshot.repCount;
  }

  const repCount = detector.getSnapshot().repCount;
  return {
    rep_count: repCount,
    partial_percent: frames.length > 0 ? (partialFrames / frames.length) * 100 : 0,
    cue_flip_rate: cueSamples > 0 ? cueFlipCount / cueSamples : 0,
    mean_overall_score:
      scoredReps.length > 0 ? scoredReps.reduce((sum, value) => sum + value, 0) / scoredReps.length : null,
    visibility_partial_rate: repCount > 0 ? visibilityPartialCount / repCount : 0,
    latency_summary: buildLatencySummary(frames),
  };
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageNullable(values: Array<number | null>): number | null {
  const filtered = values.filter((value): value is number => typeof value === 'number');
  if (filtered.length === 0) {
    return null;
  }
  return average(filtered);
}

function renderMarkdown(report: Report): string {
  const lines: string[] = [];
  lines.push('# Pull-up Tracking Evaluation Report');
  lines.push('');
  lines.push(
    '| trace | expected | before_rep | after_rep | before_partial_% | after_partial_% | before_cue_flip | after_cue_flip | before_score | after_score | within_+/-1 |',
  );
  lines.push(
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: |',
  );
  for (const trace of report.traces) {
    lines.push(
      `| ${trace.trace} | ${trace.expected_rep_count} | ${trace.before.rep_count} | ${trace.after.rep_count} | ${round(trace.before.partial_percent, 2)} | ${round(trace.after.partial_percent, 2)} | ${round(trace.before.cue_flip_rate, 4)} | ${round(trace.after.cue_flip_rate, 4)} | ${trace.before.mean_overall_score === null ? 'n/a' : round(trace.before.mean_overall_score, 2)} | ${trace.after.mean_overall_score === null ? 'n/a' : round(trace.after.mean_overall_score, 2)} | ${trace.within_accuracy_target ? 'yes' : 'no'} |`,
    );
  }
  lines.push('');
  lines.push('## Aggregate');
  lines.push('');
  lines.push('| metric | value |');
  lines.push('| --- | ---: |');
  lines.push(`| traces | ${report.aggregate.traces} |`);
  lines.push(`| within_accuracy_target | ${report.aggregate.within_accuracy_target} |`);
  lines.push(`| before_mean_rep_error | ${round(report.aggregate.before_mean_rep_error, 4)} |`);
  lines.push(`| after_mean_rep_error | ${round(report.aggregate.after_mean_rep_error, 4)} |`);
  lines.push(`| before_mean_partial_percent | ${round(report.aggregate.before_mean_partial_percent, 4)} |`);
  lines.push(`| after_mean_partial_percent | ${round(report.aggregate.after_mean_partial_percent, 4)} |`);
  lines.push(`| before_mean_cue_flip_rate | ${round(report.aggregate.before_mean_cue_flip_rate, 4)} |`);
  lines.push(`| after_mean_cue_flip_rate | ${round(report.aggregate.after_mean_cue_flip_rate, 4)} |`);
  lines.push(
    `| before_mean_overall_score | ${
      report.aggregate.before_mean_overall_score === null ? 'n/a' : round(report.aggregate.before_mean_overall_score, 4)
    } |`,
  );
  lines.push(
    `| after_mean_overall_score | ${
      report.aggregate.after_mean_overall_score === null ? 'n/a' : round(report.aggregate.after_mean_overall_score, 4)
    } |`,
  );
  return `${lines.join('\n')}\n`;
}

function buildReport(fixtureDir: string, traces: TraceResult[]): Report {
  return {
    fixture_dir: fixtureDir,
    traces,
    aggregate: {
      traces: traces.length,
      within_accuracy_target: traces.filter((trace) => trace.within_accuracy_target).length,
      before_mean_rep_error: average(traces.map((trace) => trace.rep_error_before)),
      after_mean_rep_error: average(traces.map((trace) => trace.rep_error_after)),
      before_mean_partial_percent: average(traces.map((trace) => trace.before.partial_percent)),
      after_mean_partial_percent: average(traces.map((trace) => trace.after.partial_percent)),
      before_mean_cue_flip_rate: average(traces.map((trace) => trace.before.cue_flip_rate)),
      after_mean_cue_flip_rate: average(traces.map((trace) => trace.after.cue_flip_rate)),
      before_mean_overall_score: averageNullable(traces.map((trace) => trace.before.mean_overall_score)),
      after_mean_overall_score: averageNullable(traces.map((trace) => trace.after.mean_overall_score)),
    },
  };
}

function main(): void {
  try {
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
      console.error(`fixtures not found: ${args.fixturesDir}`);
      process.exit(1);
    }

    const traces: TraceResult[] = fixtureFiles.map((fileName) => {
      const trace = fileName.replace(/\.json$/, '');
      const filePath = join(args.fixturesDir, fileName);
      const frames = loadFixture(filePath);
      const expectedRepCount = frames[0]?.expected?.repCount ?? 0;

      const before = evaluateLegacy(frames);
      const after = evaluateAfter(frames);

      const repErrorBefore = Math.abs(before.rep_count - expectedRepCount);
      const repErrorAfter = Math.abs(after.rep_count - expectedRepCount);

      return {
        trace,
        frames: frames.length,
        expected_rep_count: expectedRepCount,
        before,
        after,
        rep_error_before: repErrorBefore,
        rep_error_after: repErrorAfter,
        within_accuracy_target: repErrorAfter <= 1,
      };
    });

    const report = buildReport(args.fixturesDir, traces);
    const markdown = renderMarkdown(report);
    const machineReadable = `${JSON.stringify(report, null, 2)}\n`;

    if (args.format === 'markdown' || args.format === 'both') {
      process.stdout.write(markdown);
    }
    if (args.format === 'json' || args.format === 'both') {
      if (args.format === 'both') {
        process.stdout.write('REPORT_JSON_START\n');
      }
      process.stdout.write(machineReadable);
      if (args.format === 'both') {
        process.stdout.write('REPORT_JSON_END\n');
      }
    }

    const accuracyOk = traces.every((trace) => trace.within_accuracy_target);
    if (!accuracyOk) {
      process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message.startsWith('parse error:') ? message : `parse error: ${message}`);
    process.exit(1);
  }
}

main();
