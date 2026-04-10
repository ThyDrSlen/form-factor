export type PullupFixtureFrame = {
  timestampSec: number;
  angles: {
    leftKnee: number;
    rightKnee: number;
    leftElbow: number;
    rightElbow: number;
    leftHip: number;
    rightHip: number;
    leftShoulder: number;
    rightShoulder: number;
  };
  joints?: Record<string, { x: number; y: number; isTracked: boolean; confidence?: number }>;
  expected: { repCount: number; partialFramesMin?: number; partialFramesMax?: number };
};

export type PullupFixtureTrace = {
  name: string;
  frames: PullupFixtureFrame[];
};

type Scenario = {
  name: string;
  expected: { repCount: number; partialFramesMin?: number; partialFramesMax?: number };
  durationSec: number;
  repWindowsSec: Array<{ start: number; end: number; amplitude?: number }>;
  baseElbowDeg: number;
  elbowTravelDeg: number;
  occlusionWindowsSec?: Array<{ start: number; end: number; trackedRatio: number }>;
  noiseScaleDeg?: number;
  /** Override shoulder/head/neck Y travel (default 0.18). */
  shoulderYTravel?: number;
  /** Override hip Y travel (default 0.12). */
  hipYTravel?: number;
  /** Per-rep amplitude overrides for Y travel (fatigue degradation). Index maps to rep window index. */
  perRepYAmplitude?: number[];
};

const FPS = 30;
const DT_SEC = 1 / FPS;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function inWindow(ts: number, windows: Array<{ start: number; end: number }>): boolean {
  return windows.some((window) => ts >= window.start && ts <= window.end);
}

function repSignal(ts: number, windows: Array<{ start: number; end: number; amplitude?: number }>): number {
  for (const window of windows) {
    if (ts < window.start || ts > window.end) continue;
    const phase = (ts - window.start) / Math.max(1e-6, window.end - window.start);
    const amplitude = window.amplitude ?? 1;
    return Math.sin(Math.PI * phase) * amplitude;
  }
  return 0;
}

/**
 * Determine which rep window (by index) the timestamp falls into, or -1 if none.
 */
function activeRepWindowIndex(
  ts: number,
  windows: Array<{ start: number; end: number }>,
): number {
  for (let i = 0; i < windows.length; i++) {
    if (ts >= windows[i].start && ts <= windows[i].end) return i;
  }
  return -1;
}

/** Default base Y positions (normalized screen coords, Y=0 top, Y=1 bottom). */
const BASE_SHOULDER_Y = 0.45;
const BASE_HEAD_Y = 0.34;
const BASE_NECK_Y = 0.39;
const BASE_HIP_Y = 0.68;

const DEFAULT_SHOULDER_Y_TRAVEL = 0.18;
const DEFAULT_HIP_Y_TRAVEL = 0.12;
const Y_NOISE_PER_DEG = 0.001;

function buildTrace(scenario: Scenario, seed: number): PullupFixtureTrace {
  const rng = makeRng(seed);
  const frames: PullupFixtureFrame[] = [];
  const count = Math.floor(scenario.durationSec * FPS);
  const noiseScale = scenario.noiseScaleDeg ?? 1.1;

  const shoulderTravel = scenario.shoulderYTravel ?? DEFAULT_SHOULDER_Y_TRAVEL;
  const hipTravel = scenario.hipYTravel ?? DEFAULT_HIP_Y_TRAVEL;

  for (let index = 0; index < count; index += 1) {
    const timestampSec = Number((index * DT_SEC).toFixed(3));
    const rep = repSignal(timestampSec, scenario.repWindowsSec);
    const occluded = inWindow(timestampSec, scenario.occlusionWindowsSec ?? []);
    const occlusionRatio = (scenario.occlusionWindowsSec ?? []).find(
      (window) => timestampSec >= window.start && timestampSec <= window.end,
    )?.trackedRatio;

    const trackedRandom = rng();
    const tracked = occluded ? trackedRandom < (occlusionRatio ?? 0.35) : true;
    const noise = () => (rng() - 0.5) * 2 * noiseScale;
    const shoulderNoise = () => (rng() - 0.5) * 1.4;
    const elbowCenter = scenario.baseElbowDeg - scenario.elbowTravelDeg * rep;

    const leftElbow = Number((elbowCenter + noise()).toFixed(2));
    const rightElbow = Number((elbowCenter + noise()).toFixed(2));
    const leftShoulder = Number((92 - rep * 18 + shoulderNoise()).toFixed(2));
    const rightShoulder = Number((92 - rep * 18 + shoulderNoise()).toFixed(2));
    const hipBase = 146 + Math.sin(timestampSec * 1.4) * 2;
    const kneeBase = 127 + Math.sin(timestampSec * 1.1) * 1.8;

    const jitter = occluded ? 0.02 : 0.004;
    const xCenter = scenario.name === 'back-turned' ? 0.58 : 0.5;

    // --- Vertical displacement: shoulder/head/neck/hip Y oscillation ---
    // Per-rep amplitude override (for fatigue degradation scenarios)
    const repWindowIdx = activeRepWindowIndex(timestampSec, scenario.repWindowsSec);
    const perRepScale =
      scenario.perRepYAmplitude && repWindowIdx >= 0 && repWindowIdx < scenario.perRepYAmplitude.length
        ? scenario.perRepYAmplitude[repWindowIdx]
        : 1;

    const effectiveShoulderTravel = shoulderTravel * perRepScale;
    const effectiveHipTravel = hipTravel * perRepScale;

    // Y noise from angle noise scale
    const yNoise = () => (rng() - 0.5) * 2 * noiseScale * Y_NOISE_PER_DEG;

    // Shoulders move UP (lower Y) during pull. rep=0 -> base, rep=1 -> base - travel
    const shoulderYDisp = tracked ? rep * effectiveShoulderTravel : 0;
    const hipYDisp = tracked ? rep * effectiveHipTravel : 0;

    // Hand Y: base travel (0.17) plus shoulder displacement to preserve shoulder-hand gap dynamics.
    // The gap detector measures shoulderY - handY delta from baseline.
    // With both shoulders and hands moving up, handTravel must exceed shoulderTravel for positive gap delta.
    const handBaseTravel = 0.17;
    const handTotalTravel = handBaseTravel + effectiveShoulderTravel;
    const leftWristY = 0.61 - rep * handTotalTravel + (rng() - 0.5) * jitter;
    const rightWristY = 0.61 - rep * handTotalTravel + (rng() - 0.5) * jitter;

    const headY = Number((BASE_HEAD_Y - shoulderYDisp + yNoise()).toFixed(4));
    const neckY = Number((BASE_NECK_Y - shoulderYDisp + yNoise()).toFixed(4));
    const leftShoulderY = Number((BASE_SHOULDER_Y - shoulderYDisp + yNoise()).toFixed(4));
    const rightShoulderY = Number((BASE_SHOULDER_Y - shoulderYDisp + yNoise()).toFixed(4));
    const leftHipY = Number((BASE_HIP_Y - hipYDisp + yNoise()).toFixed(4));
    const rightHipY = Number((BASE_HIP_Y - hipYDisp + yNoise()).toFixed(4));

    frames.push({
      timestampSec,
      angles: {
        leftKnee: Number((kneeBase + noise() * 0.5).toFixed(2)),
        rightKnee: Number((kneeBase + noise() * 0.5).toFixed(2)),
        leftElbow,
        rightElbow,
        leftHip: Number((hipBase + noise() * 0.35).toFixed(2)),
        rightHip: Number((hipBase + noise() * 0.35).toFixed(2)),
        leftShoulder,
        rightShoulder,
      },
      joints: {
        head: { x: Number((xCenter + (rng() - 0.5) * jitter).toFixed(4)), y: headY, isTracked: tracked, confidence: tracked ? 0.95 : 0.31 },
        neck: { x: Number((xCenter + (rng() - 0.5) * jitter).toFixed(4)), y: neckY, isTracked: tracked, confidence: tracked ? 0.94 : 0.29 },
        left_shoulder: { x: Number((xCenter - 0.1 + (rng() - 0.5) * jitter).toFixed(4)), y: leftShoulderY, isTracked: tracked, confidence: tracked ? 0.93 : 0.27 },
        right_shoulder: { x: Number((xCenter + 0.1 + (rng() - 0.5) * jitter).toFixed(4)), y: rightShoulderY, isTracked: tracked, confidence: tracked ? 0.93 : 0.27 },
        left_hand: { x: Number((xCenter - 0.16 + (rng() - 0.5) * jitter).toFixed(4)), y: Number(leftWristY.toFixed(4)), isTracked: tracked, confidence: tracked ? 0.92 : 0.25 },
        right_hand: { x: Number((xCenter + 0.16 + (rng() - 0.5) * jitter).toFixed(4)), y: Number(rightWristY.toFixed(4)), isTracked: tracked, confidence: tracked ? 0.92 : 0.25 },
        left_hip: { x: Number((xCenter - 0.08 + (rng() - 0.5) * jitter).toFixed(4)), y: leftHipY, isTracked: tracked, confidence: tracked ? 0.91 : 0.24 },
        right_hip: { x: Number((xCenter + 0.08 + (rng() - 0.5) * jitter).toFixed(4)), y: rightHipY, isTracked: tracked, confidence: tracked ? 0.91 : 0.24 },
      },
      expected: scenario.expected,
    });
  }

  return { name: scenario.name, frames };
}

export function buildPullupFixtureCorpus(): PullupFixtureTrace[] {
  const scenarios: Scenario[] = [
    {
      name: 'camera-facing',
      expected: { repCount: 2, partialFramesMin: 20, partialFramesMax: 65 },
      durationSec: 9.8,
      repWindowsSec: [
        { start: 1.1, end: 3.5 },
        { start: 5.2, end: 7.5 },
      ],
      baseElbowDeg: 156,
      elbowTravelDeg: 80,
    },
    {
      name: 'back-turned',
      expected: { repCount: 1, partialFramesMin: 12, partialFramesMax: 48 },
      durationSec: 7.2,
      repWindowsSec: [{ start: 2.1, end: 4.8 }],
      baseElbowDeg: 154,
      elbowTravelDeg: 76,
      noiseScaleDeg: 1.4,
    },
    {
      name: 'back-turned-multi',
      expected: { repCount: 3, partialFramesMin: 30, partialFramesMax: 100 },
      durationSec: 14.0,
      repWindowsSec: [
        { start: 1.5, end: 3.8 },
        { start: 5.0, end: 7.3 },
        { start: 8.8, end: 11.2 },
      ],
      baseElbowDeg: 154,
      elbowTravelDeg: 76,
      noiseScaleDeg: 1.4,
    },
    {
      name: 'back-turned-no-deadhang',
      expected: { repCount: 2, partialFramesMin: 18, partialFramesMax: 70 },
      durationSec: 10.0,
      repWindowsSec: [
        { start: 1.0, end: 3.2 },
        { start: 4.8, end: 7.0 },
      ],
      baseElbowDeg: 152,
      elbowTravelDeg: 68,
      noiseScaleDeg: 1.3,
      shoulderYTravel: 0.12,
      hipYTravel: 0.08,
    },
    {
      name: 'vertical-displacement',
      expected: { repCount: 2, partialFramesMin: 22, partialFramesMax: 68 },
      durationSec: 10.5,
      repWindowsSec: [
        { start: 1.3, end: 3.8 },
        { start: 5.5, end: 8.0 },
      ],
      baseElbowDeg: 155,
      elbowTravelDeg: 78,
      shoulderYTravel: 0.20,
      hipYTravel: 0.14,
    },
    {
      name: 'side-angle',
      expected: { repCount: 2, partialFramesMin: 20, partialFramesMax: 65 },
      durationSec: 10.0,
      repWindowsSec: [
        { start: 1.2, end: 3.6 },
        { start: 5.4, end: 7.8 },
      ],
      baseElbowDeg: 155,
      elbowTravelDeg: 78,
      noiseScaleDeg: 1.6,
    },
    {
      name: 'fatigue-degradation',
      expected: { repCount: 5, partialFramesMin: 40, partialFramesMax: 150 },
      durationSec: 22.0,
      repWindowsSec: [
        { start: 1.0, end: 3.2 },
        { start: 4.5, end: 6.8 },
        { start: 8.0, end: 10.4 },
        { start: 11.8, end: 14.5, amplitude: 0.85 },
        { start: 16.0, end: 19.0, amplitude: 0.70 },
      ],
      baseElbowDeg: 156,
      elbowTravelDeg: 80,
      noiseScaleDeg: 1.3,
      // Y amplitude decreases with fatigue: 0.18 for reps 1-3, 0.14 for rep 4, 0.10 for rep 5
      perRepYAmplitude: [1.0, 1.0, 1.0, 0.78, 0.56],
    },
    {
      name: 'tracking-dropout-recovery',
      expected: { repCount: 2, partialFramesMin: 20, partialFramesMax: 72 },
      durationSec: 11.0,
      repWindowsSec: [
        { start: 1.5, end: 3.8 },
        { start: 6.0, end: 8.5 },
      ],
      baseElbowDeg: 155,
      elbowTravelDeg: 78,
      occlusionWindowsSec: [{ start: 4.0, end: 5.5, trackedRatio: 0.0 }],
      noiseScaleDeg: 1.2,
    },
    {
      name: 'occlusion-brief',
      expected: { repCount: 1, partialFramesMin: 18, partialFramesMax: 56 },
      durationSec: 8.0,
      repWindowsSec: [{ start: 1.9, end: 4.9 }],
      baseElbowDeg: 155,
      elbowTravelDeg: 78,
      occlusionWindowsSec: [{ start: 2.7, end: 3.15, trackedRatio: 0.32 }],
      noiseScaleDeg: 1.5,
    },
    {
      name: 'occlusion-long',
      expected: { repCount: 0, partialFramesMin: 25, partialFramesMax: 90 },
      durationSec: 8.8,
      repWindowsSec: [{ start: 2.0, end: 5.4 }],
      baseElbowDeg: 156,
      elbowTravelDeg: 54,
      occlusionWindowsSec: [{ start: 2.4, end: 5.3, trackedRatio: 0.08 }],
      noiseScaleDeg: 2.1,
    },
    {
      name: 'bounce-noise',
      expected: { repCount: 1, partialFramesMin: 24, partialFramesMax: 80 },
      durationSec: 8.3,
      repWindowsSec: [
        { start: 1.6, end: 3.8 },
        { start: 4.05, end: 4.8, amplitude: 0.62 },
      ],
      baseElbowDeg: 154,
      elbowTravelDeg: 72,
      noiseScaleDeg: 2.4,
    },
  ];

  return scenarios.map((scenario, idx) => buildTrace(scenario, 9101 + idx * 97));
}
