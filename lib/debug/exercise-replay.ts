import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import { getWorkoutIds, type DetectionMode } from '@/lib/workouts';

export interface ExerciseReplayFrame {
  /** Controller's input clock in milliseconds, not ARKit's seconds. */
  timestampMs: number;
  angles: JointAngles;
  joints?: Record<string, { x: number; y: number; isTracked: boolean; confidence?: number }>;
  context?: { trackingQuality?: number; shadowMeanAbsDelta?: number | null };
}

export interface ExerciseReplayReset {
  /** Reset before this frame index; frames.length means at the end. */
  beforeFrame: number;
  preserveRepCount: boolean;
}

export interface ExerciseRecording {
  version: 1;
  source: 'recorded' | 'synthetic';
  /** After camera processing/quality gates. Does not validate native pose inference. */
  stage: 'controller-input';
  workoutId: DetectionMode;
  frames: ExerciseReplayFrame[];
  resets?: ExerciseReplayReset[];
  /** Optional human-reviewed label, never derived from detector output. */
  expectedRepCount?: number;
}

export interface ExerciseReplayTarget {
  /** Must reset ALL controller state. Bind to setWorkout on a replay-mode controller. */
  reset: (workoutId: DetectionMode, options?: { preserveRepCount: boolean }) => void;
  processFrame: (
    angles: JointAngles,
    joints: Map<string, NonNullable<ExerciseReplayFrame['joints']>[string]> | undefined,
    context: ExerciseReplayFrame['context'] & { timestampMs: number },
  ) => void;
}

/** Input driver only. All detection and scoring stays in the production controller. */
export class ExerciseReplay {
  private readonly recording: ExerciseRecording;
  private index = 0;
  private resetIndex = 0;

  constructor(recording: ExerciseRecording, private readonly target: ExerciseReplayTarget) {
    this.recording = parseExerciseRecording(recording);
    target.reset(this.recording.workoutId);
  }

  get position(): number { return this.index; }

  run(): void {
    while (this.step()) { /* recorded time, no wall-clock sleeps */ }
  }

  restart(): void {
    this.target.reset(this.recording.workoutId);
    this.index = 0;
    this.resetIndex = 0;
  }

  /** Seeking cannot skip stateful phase history: reset and replay the prefix. */
  seek(frameCount: number): void {
    if (!Number.isInteger(frameCount) || frameCount < 0 || frameCount > this.recording.frames.length) {
      throw new Error('Seek frame count is out of range');
    }
    this.restart();
    while (this.index < frameCount) this.step();
  }

  step(): boolean {
    this.applyResets();
    const input = this.recording.frames[this.index];
    if (!input) return false;
    const frame = parseFrame(input);
    // Positive fixed epoch avoids the controller's zero-as-unset sentinel.
    // Playback speed / pauses must NEVER scale this clock.
    const timestampMs = 1700000000000 + (frame.timestampMs - this.recording.frames[0].timestampMs);
    this.target.processFrame(frame.angles, frame.joints ? new Map(Object.entries(frame.joints)) : undefined, {
      ...frame.context, timestampMs,
    });
    this.index += 1;
    if (this.index === this.recording.frames.length) this.applyResets();
    return true;
  }

  private applyResets(): void {
    const reset = this.recording.resets?.[this.resetIndex];
    if (reset?.beforeFrame === this.index) {
      this.target.reset(this.recording.workoutId, { preserveRepCount: reset.preserveRepCount });
      this.resetIndex += 1;
    }
  }
}

export const MAX_REPLAY_FRAMES = 18000;
/** Opt-in capture of the exact accepted controller inputs. No network or storage. */
export class ExerciseRecorder {
  private readonly frames: ExerciseReplayFrame[] = [];
  private readonly resets: ExerciseReplayReset[] = [];

  constructor(private readonly workoutId: DetectionMode) {}

  append(input: ExerciseReplayFrame): void {
    if (this.frames.length >= MAX_REPLAY_FRAMES) throw new Error('Recording frame limit reached');
    const frame = parseFrame(input);
    const previous = this.frames[this.frames.length - 1];
    // Date.now() can stamp distinct accepted live frames with the same millisecond.
    if (previous && frame.timestampMs < previous.timestampMs) throw new Error('timestampMs must be nondecreasing');
    this.frames.push(frame);
  }

  reset(options?: { preserveRepCount?: boolean }): void {
    const preserveRepCount = options?.preserveRepCount === true;
    const previous = this.resets[this.resets.length - 1];
    if (previous?.beforeFrame === this.frames.length) {
      previous.preserveRepCount = previous.preserveRepCount && preserveRepCount;
    } else {
      this.resets.push({ beforeFrame: this.frames.length, preserveRepCount });
    }
  }

  finish(): ExerciseRecording {
    return parseExerciseRecording({
      version: 1, source: 'recorded', stage: 'controller-input', workoutId: this.workoutId, frames: this.frames,
      ...(this.resets.length ? { resets: this.resets } : {}),
    });
  }
}

const ANGLE_KEYS: (keyof JointAngles)[] = [
  'leftElbow', 'rightElbow', 'leftShoulder', 'rightShoulder',
  'leftHip', 'rightHip', 'leftKnee', 'rightKnee',
];

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be finite`);
  }
  return value;
}

function parseFrame(value: unknown): ExerciseReplayFrame {
  const input = object(value, 'frame');
  const timestampMs = finite(input.timestampMs, 'timestampMs');
  if (timestampMs < 0 || timestampMs > Number.MAX_SAFE_INTEGER) throw new Error('timestampMs out of range');
  const rawAngles = object(input.angles, 'angles');
  const angles = {} as JointAngles;
  for (const key of ANGLE_KEYS) angles[key] = finite(rawAngles[key], `angles.${key}`);
  const frame: ExerciseReplayFrame = { timestampMs, angles };
  if (input.joints !== undefined) {
    const rawJoints = object(input.joints, 'joints');
    frame.joints = Object.fromEntries(Object.entries(rawJoints).map(([key, value]) => {
      const joint = object(value, `joints.${key}`);
      if (typeof joint.isTracked !== 'boolean') throw new Error(`joints.${key}.isTracked must be boolean`);
      return [key, {
        x: finite(joint.x, `joints.${key}.x`), y: finite(joint.y, `joints.${key}.y`),
        isTracked: joint.isTracked,
        ...(joint.confidence === undefined ? {} : { confidence: unit(joint.confidence, 'confidence') }),
      }];
    }));
  }
  if (input.context !== undefined) {
    const context = object(input.context, 'context');
    frame.context = {};
    if (context.trackingQuality !== undefined) frame.context.trackingQuality = unit(context.trackingQuality, 'trackingQuality');
    if (context.shadowMeanAbsDelta !== undefined) {
      frame.context.shadowMeanAbsDelta = context.shadowMeanAbsDelta === null
        ? null : finite(context.shadowMeanAbsDelta, 'shadowMeanAbsDelta');
      if (frame.context.shadowMeanAbsDelta !== null && frame.context.shadowMeanAbsDelta < 0) {
        throw new Error('shadowMeanAbsDelta must be nonnegative');
      }
    }
  }
  return frame;
}

function unit(value: unknown, label: string): number {
  const number = finite(value, label);
  if (number < 0 || number > 1) throw new Error(`${label} must be between 0 and 1`);
  return number;
}

export function parseExerciseRecording(value: unknown): ExerciseRecording {
  const input = object(value, 'recording');
  if (input.version !== 1 || input.stage !== 'controller-input') {
    throw new Error('Unsupported recording version or stage');
  }
  if (input.source !== 'recorded' && input.source !== 'synthetic') {
    throw new Error('Recording source must be recorded or synthetic');
  }
  if (!getWorkoutIds().includes(input.workoutId as DetectionMode)) {
    throw new Error('Unknown workoutId');
  }
  if (!Array.isArray(input.frames) || input.frames.length === 0 || input.frames.length > MAX_REPLAY_FRAMES) {
    throw new Error(`Recording must contain 1..${MAX_REPLAY_FRAMES} frames`);
  }
  const frames = input.frames.map(parseFrame);
  frames.forEach((frame, index) => {
    if (index > 0 && frame.timestampMs < frames[index - 1].timestampMs) {
      throw new Error(`Frame ${index}: timestampMs must be nondecreasing`);
    }
  });
  let resets: ExerciseReplayReset[] | undefined;
  if (input.resets !== undefined) {
    if (!Array.isArray(input.resets) || input.resets.length > frames.length + 1) throw new Error('Invalid resets');
    let previous = -1;
    resets = input.resets.map((value) => {
      const reset = object(value, 'reset');
      const beforeFrame = finite(reset.beforeFrame, 'beforeFrame');
      if (!Number.isInteger(beforeFrame) || beforeFrame <= previous || beforeFrame > frames.length || typeof reset.preserveRepCount !== 'boolean') {
        throw new Error('Resets must have strictly increasing frame indices and boolean preserveRepCount');
      }
      previous = beforeFrame;
      return { beforeFrame, preserveRepCount: reset.preserveRepCount };
    });
  }
  if (input.expectedRepCount !== undefined &&
    (typeof input.expectedRepCount !== 'number' || !Number.isSafeInteger(input.expectedRepCount) || input.expectedRepCount < 0)) {
    throw new Error('expectedRepCount must be a nonnegative integer');
  }
  return {
    version: 1, source: input.source, stage: 'controller-input',
    workoutId: input.workoutId as DetectionMode, frames,
    ...(resets === undefined ? {} : { resets }),
    ...(input.expectedRepCount === undefined ? {} : { expectedRepCount: input.expectedRepCount as number }),
  };
}
