import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';

type JointValidity = Record<keyof JointAngles, boolean>;

const JOINT_KEYS: Array<keyof JointAngles> = [
  'leftKnee',
  'rightKnee',
  'leftElbow',
  'rightElbow',
  'leftHip',
  'rightHip',
  'leftShoulder',
  'rightShoulder',
];

export interface RealtimeFormEngineState {
  smoothed: JointAngles | null;
  lastTimestampSec: number | null;
}

export interface RealtimeFormEngineOutput {
  angles: JointAngles;
  alpha: number;
  trackingQuality: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function scoreFromShadowDelta(shadowMeanAbsDelta?: number | null): number {
  if (typeof shadowMeanAbsDelta !== 'number' || !Number.isFinite(shadowMeanAbsDelta)) {
    return 1;
  }

  return clamp(1 - shadowMeanAbsDelta / 28, 0.2, 1);
}

function computeAlpha(shadowScore: number): number {
  return clamp(0.22 + shadowScore * 0.28, 0.22, 0.50);
}

function maxDeltaForFrameMs(dtMs: number, trackingQuality: number): number {
  const baseVelocityDegPerSec = 460;
  const qualityScale = 0.65 + trackingQuality * 0.5;
  return (baseVelocityDegPerSec * qualityScale * dtMs) / 1000;
}

export function createRealtimeFormEngineState(): RealtimeFormEngineState {
  return {
    smoothed: null,
    lastTimestampSec: null,
  };
}

export function processRealtimeAngles(input: {
  state: RealtimeFormEngineState;
  angles: JointAngles;
  valid: JointValidity;
  timestampSec: number;
  shadowMeanAbsDelta?: number | null;
  workoutId?: string;
}): RealtimeFormEngineOutput {
  const shadowScore = scoreFromShadowDelta(input.shadowMeanAbsDelta);
  const qualityKeys = input.workoutId === 'dumbbell_curl'
    ? JOINT_KEYS.filter(key => key !== 'leftKnee' && key !== 'rightKnee')
    : JOINT_KEYS;
  const trackedCount = qualityKeys.reduce((count, key) => count + (input.valid[key] && Number.isFinite(input.angles[key]) ? 1 : 0), 0);
  const trackedScore = trackedCount / qualityKeys.length;
  const trackingQuality = clamp(trackedScore * 0.65 + shadowScore * 0.35, 0, 1);
  const alpha = computeAlpha(shadowScore);

  const previous = input.state.smoothed;
  if (!previous || input.state.lastTimestampSec === null) {
    input.state.smoothed = { ...input.angles };
    input.state.lastTimestampSec = input.timestampSec;
    return { angles: input.state.smoothed, alpha, trackingQuality };
  }

  const dtMs = clamp((input.timestampSec - input.state.lastTimestampSec) * 1000, 4, 160);
  const maxDelta = maxDeltaForFrameMs(dtMs, trackingQuality);

  const next = { ...previous };
  for (const key of JOINT_KEYS) {
    const incoming = input.angles[key];
    if (!input.valid[key] || !Number.isFinite(incoming)) {
      next[key] = previous[key];
      continue;
    }

    // There is no usable baseline to smooth against after an unavailable
    // initial sample. Seed only this joint from its first tracked finite value.
    if (!Number.isFinite(previous[key])) {
      next[key] = incoming;
      continue;
    }

    const delta = incoming - previous[key];
    const limited = clamp(delta, -maxDelta, maxDelta);
    next[key] = previous[key] + limited * alpha;
  }

  input.state.smoothed = next;
  input.state.lastTimestampSec = input.timestampSec;

  return {
    angles: next,
    alpha,
    trackingQuality,
  };
}
