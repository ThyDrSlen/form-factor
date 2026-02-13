import { compareJointAngles } from '@/lib/pose/shadow-metrics';
import { buildMediaPipeShadowFrameFromLandmarks } from '@/lib/pose/adapters/mediapipe-workout-adapter';
import { createRealtimeFormEngineState, processRealtimeAngles } from '@/lib/pose/realtime-form-engine';
import { computeAdaptivePhaseHoldMs, computeAdaptiveRepDurationMs } from '@/lib/services/workout-runtime';
import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';

type Sample = {
  angles: JointAngles;
  timestampSec: number;
  landmarks: Array<{ x: number; y: number; visibility: number }>;
  valid: Record<keyof JointAngles, boolean>;
};

const JOINTS: Array<keyof JointAngles> = [
  'leftKnee',
  'rightKnee',
  'leftElbow',
  'rightElbow',
  'leftHip',
  'rightHip',
  'leftShoulder',
  'rightShoulder',
];

const BASE_ANGLES: JointAngles = {
  leftKnee: 128,
  rightKnee: 129,
  leftElbow: 98,
  rightElbow: 99,
  leftHip: 144,
  rightHip: 143,
  leftShoulder: 92,
  rightShoulder: 91,
};

function random(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 1) & 0x7fffffff) / 0x7fffffff;
  };
}

function makeLandmarks(rng: () => number, t: number): Array<{ x: number; y: number; visibility: number }> {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  const sway = Math.sin(t * 2.3) * 0.02;
  landmarks[0] = { x: 0.5 + sway * 0.3, y: 0.2, visibility: 0.9 };
  landmarks[11] = { x: 0.42 + sway, y: 0.3, visibility: 0.88 };
  landmarks[12] = { x: 0.58 + sway, y: 0.3, visibility: 0.88 };
  landmarks[13] = { x: 0.35 + sway * 1.1, y: 0.42 + Math.sin(t * 4) * 0.01, visibility: 0.86 };
  landmarks[14] = { x: 0.65 + sway * 1.1, y: 0.42 + Math.sin(t * 4.1) * 0.01, visibility: 0.86 };
  landmarks[15] = { x: 0.3 + sway * 1.2, y: 0.55 + Math.sin(t * 4.3) * 0.02, visibility: 0.84 };
  landmarks[16] = { x: 0.7 + sway * 1.2, y: 0.55 + Math.sin(t * 4.4) * 0.02, visibility: 0.84 };
  landmarks[23] = { x: 0.46 + sway * 0.7, y: 0.52, visibility: 0.9 };
  landmarks[24] = { x: 0.54 + sway * 0.7, y: 0.52, visibility: 0.9 };
  landmarks[25] = { x: 0.44 + sway * 0.5, y: 0.7, visibility: 0.89 };
  landmarks[26] = { x: 0.56 + sway * 0.5, y: 0.7, visibility: 0.89 };
  landmarks[27] = { x: 0.42 + sway * 0.4, y: 0.9, visibility: 0.88 };
  landmarks[28] = { x: 0.58 + sway * 0.4, y: 0.9, visibility: 0.88 };

  if (rng() < 0.04) {
    landmarks[13].visibility = 0.35;
  }
  if (rng() < 0.04) {
    landmarks[14].visibility = 0.35;
  }

  return landmarks;
}

function makeSamples(frameCount: number, fps: number, seed: number): Sample[] {
  const rng = random(seed);
  const dt = 1 / fps;
  const samples: Sample[] = [];

  for (let i = 0; i < frameCount; i += 1) {
    const t = i * dt;
    const cycle = Math.sin(t * 2 * Math.PI * 0.7);
    const noise = () => (rng() - 0.5) * 2.4;
    const angles: JointAngles = {
      leftKnee: BASE_ANGLES.leftKnee + cycle * 8 + noise(),
      rightKnee: BASE_ANGLES.rightKnee + cycle * 8 + noise(),
      leftElbow: BASE_ANGLES.leftElbow - cycle * 26 + noise(),
      rightElbow: BASE_ANGLES.rightElbow - cycle * 26 + noise(),
      leftHip: BASE_ANGLES.leftHip + cycle * 6 + noise(),
      rightHip: BASE_ANGLES.rightHip + cycle * 6 + noise(),
      leftShoulder: BASE_ANGLES.leftShoulder + cycle * 10 + noise(),
      rightShoulder: BASE_ANGLES.rightShoulder + cycle * 10 + noise(),
    };

    const valid = {
      leftKnee: rng() > 0.03,
      rightKnee: rng() > 0.03,
      leftElbow: rng() > 0.04,
      rightElbow: rng() > 0.04,
      leftHip: rng() > 0.03,
      rightHip: rng() > 0.03,
      leftShoulder: rng() > 0.03,
      rightShoulder: rng() > 0.03,
    };

    samples.push({
      angles,
      timestampSec: t,
      landmarks: makeLandmarks(rng, t),
      valid,
    });
  }

  return samples;
}

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function main(): void {
  const frames = parseEnvInt('FF_PERF_FRAMES', 5000);
  const fps = parseEnvInt('FF_PERF_FPS', 30);
  const seed = parseEnvInt('FF_PERF_SEED', 42);
  const samples = makeSamples(frames, fps, seed);

  const formState = createRealtimeFormEngineState();
  const recentRepDurations: number[] = [];
  let lastShadowMeanAbsDelta: number | null = null;
  let trackingQualityTotal = 0;
  let shadowDeltaTotal = 0;

  const startNs = process.hrtime.bigint();

  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    const smoothed = processRealtimeAngles({
      state: formState,
      angles: sample.angles,
      valid: sample.valid,
      timestampSec: sample.timestampSec,
      shadowMeanAbsDelta: lastShadowMeanAbsDelta,
    });

    const shadowFrame = buildMediaPipeShadowFrameFromLandmarks({
      primaryAngles: smoothed.angles,
      landmarks: sample.landmarks,
      timestamp: sample.timestampSec,
      inferenceMs: 10,
    });

    const comparison = compareJointAngles(smoothed.angles, shadowFrame.angles, {
      provider: shadowFrame.provider,
      modelVersion: shadowFrame.modelVersion,
      inferenceMs: shadowFrame.inferenceMs,
      coverageRatio: shadowFrame.coverageRatio,
    });

    lastShadowMeanAbsDelta = comparison.meanAbsDelta;
    trackingQualityTotal += smoothed.trackingQuality;
    shadowDeltaTotal += comparison.meanAbsDelta;

    if (i % Math.max(1, Math.floor(fps * 1.6)) === 0 && i > 0) {
      const syntheticDuration = 900 + (i % 300);
      recentRepDurations.push(syntheticDuration);
      if (recentRepDurations.length > 6) {
        recentRepDurations.shift();
      }
    }

    computeAdaptiveRepDurationMs({
      baseMinDurationMs: 400,
      recentRepDurationsMs: recentRepDurations,
      trackingQuality: smoothed.trackingQuality,
    });
    computeAdaptivePhaseHoldMs({
      trackingQuality: smoothed.trackingQuality,
      shadowMeanAbsDelta: comparison.meanAbsDelta,
    });
  }

  const elapsedNs = process.hrtime.bigint() - startNs;
  const elapsedMs = Number(elapsedNs) / 1e6;
  const frameMs = elapsedMs / frames;
  const throughputFps = 1000 / frameMs;
  const avgTrackingQuality = trackingQualityTotal / frames;
  const avgShadowDelta = shadowDeltaTotal / frames;

  console.log('[perf-workout-engine]');
  console.log(`frames=${frames} fps_input=${fps} seed=${seed}`);
  console.log(`elapsed_ms=${elapsedMs.toFixed(2)} frame_ms=${frameMs.toFixed(4)} throughput_fps=${throughputFps.toFixed(2)}`);
  console.log(`avg_tracking_quality=${avgTrackingQuality.toFixed(4)} avg_shadow_mean_abs_delta=${avgShadowDelta.toFixed(4)}`);
  console.log(`joints=${JOINTS.length} modules=realtime-form-engine,mediapipe-adapter,shadow-metrics,workout-runtime`);
}

main();
