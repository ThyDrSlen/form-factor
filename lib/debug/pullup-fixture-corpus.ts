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

function buildTrace(scenario: Scenario, seed: number): PullupFixtureTrace {
  const rng = makeRng(seed);
  const frames: PullupFixtureFrame[] = [];
  const count = Math.floor(scenario.durationSec * FPS);
  const noiseScale = scenario.noiseScaleDeg ?? 1.1;

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
    const leftWristY = 0.61 - rep * 0.17 + (rng() - 0.5) * jitter;
    const rightWristY = 0.61 - rep * 0.17 + (rng() - 0.5) * jitter;

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
        head: { x: Number((xCenter + (rng() - 0.5) * jitter).toFixed(4)), y: 0.22, isTracked: tracked, confidence: tracked ? 0.95 : 0.31 },
        neck: { x: Number((xCenter + (rng() - 0.5) * jitter).toFixed(4)), y: 0.29, isTracked: tracked, confidence: tracked ? 0.94 : 0.29 },
        left_shoulder: { x: Number((xCenter - 0.1 + (rng() - 0.5) * jitter).toFixed(4)), y: 0.33, isTracked: tracked, confidence: tracked ? 0.93 : 0.27 },
        right_shoulder: { x: Number((xCenter + 0.1 + (rng() - 0.5) * jitter).toFixed(4)), y: 0.33, isTracked: tracked, confidence: tracked ? 0.93 : 0.27 },
        left_hand: { x: Number((xCenter - 0.16 + (rng() - 0.5) * jitter).toFixed(4)), y: Number(leftWristY.toFixed(4)), isTracked: tracked, confidence: tracked ? 0.92 : 0.25 },
        right_hand: { x: Number((xCenter + 0.16 + (rng() - 0.5) * jitter).toFixed(4)), y: Number(rightWristY.toFixed(4)), isTracked: tracked, confidence: tracked ? 0.92 : 0.25 },
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
