/**
 * Push-up Fixture Corpus
 *
 * Generates synthetic push-up tracking data with elbow angle oscillation
 * and shoulder Y movement. Push-ups differ from pull-ups:
 *   - Primary angle: elbow (ROM ~155 top -> ~90 bottom)
 *   - Vertical: shoulders go DOWN on lowering, UP on pressing
 *   - Body horizontal: shoulder Y oscillation is smaller (~0.05-0.08)
 *   - Hands are planted on ground (static wrist position)
 */

export type PushupFixtureFrame = {
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
  expected: { repCount: number };
};

export type PushupFixtureTrace = {
  name: string;
  frames: PushupFixtureFrame[];
};

type Scenario = {
  name: string;
  expected: { repCount: number };
  durationSec: number;
  /** Each window is one rep: elbow goes from top -> bottom -> top */
  repWindowsSec: Array<{ start: number; end: number; amplitude?: number }>;
  /** Elbow angle at lockout (plank position, ~155) */
  baseElbowDeg: number;
  /** How far elbow bends: 155 - 90 = 65 for full depth */
  elbowTravelDeg: number;
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

function repSignal(ts: number, windows: Array<{ start: number; end: number; amplitude?: number }>): number {
  for (const window of windows) {
    if (ts < window.start || ts > window.end) continue;
    const phase = (ts - window.start) / Math.max(1e-6, window.end - window.start);
    const amplitude = window.amplitude ?? 1;
    // sin(PI * phase) produces 0 -> 1 -> 0 over the window
    return Math.sin(Math.PI * phase) * amplitude;
  }
  return 0;
}

function buildTrace(scenario: Scenario, seed: number): PushupFixtureTrace {
  const rng = makeRng(seed);
  const frames: PushupFixtureFrame[] = [];
  const count = Math.floor(scenario.durationSec * FPS);
  const noiseScale = scenario.noiseScaleDeg ?? 1.1;

  for (let index = 0; index < count; index += 1) {
    const timestampSec = Number((index * DT_SEC).toFixed(3));
    const rep = repSignal(timestampSec, scenario.repWindowsSec);

    const noise = () => (rng() - 0.5) * 2 * noiseScale;
    const shoulderNoise = () => (rng() - 0.5) * 1.4;

    // Elbow: starts at baseElbowDeg (high/lockout), bends down by elbowTravelDeg * rep
    const elbowCenter = scenario.baseElbowDeg - scenario.elbowTravelDeg * rep;
    const leftElbow = Number((elbowCenter + noise()).toFixed(2));
    const rightElbow = Number((elbowCenter + noise()).toFixed(2));

    // Shoulder angles: relatively stable during push-ups (~45-55 range)
    // Slight increase when lowering as upper arm rotates
    const leftShoulder = Number((50 + rep * 12 + shoulderNoise()).toFixed(2));
    const rightShoulder = Number((50 + rep * 12 + shoulderNoise()).toFixed(2));

    // Hips stay straight in plank (~175 deg), slight oscillation
    const hipBase = 175 + Math.sin(timestampSec * 1.2) * 1.5;
    // Knees locked out in plank (~170 deg)
    const kneeBase = 170 + Math.sin(timestampSec * 0.9) * 1.2;

    const jitter = 0.004;
    const xCenter = scenario.name === 'side-angle' ? 0.42 : 0.5;

    // Shoulder Y: in push-up the body is horizontal, shoulders go DOWN when lowering
    // Smaller oscillation than pull-ups (~0.05-0.08 range)
    const shoulderYBase = 0.38;
    const shoulderYDelta = rep * 0.06;
    const leftShoulderY = shoulderYBase + shoulderYDelta + (rng() - 0.5) * jitter;
    const rightShoulderY = shoulderYBase + shoulderYDelta + (rng() - 0.5) * jitter;

    // Hands are planted on the ground -- mostly static
    const handY = 0.52 + (rng() - 0.5) * jitter;

    frames.push({
      timestampSec,
      angles: {
        leftKnee: Number((kneeBase + noise() * 0.3).toFixed(2)),
        rightKnee: Number((kneeBase + noise() * 0.3).toFixed(2)),
        leftElbow,
        rightElbow,
        leftHip: Number((hipBase + noise() * 0.25).toFixed(2)),
        rightHip: Number((hipBase + noise() * 0.25).toFixed(2)),
        leftShoulder,
        rightShoulder,
      },
      joints: {
        head: {
          x: Number((xCenter - 0.02 + (rng() - 0.5) * jitter).toFixed(4)),
          y: Number((0.32 + shoulderYDelta * 0.8 + (rng() - 0.5) * jitter).toFixed(4)),
          isTracked: true,
          confidence: 0.95,
        },
        neck: {
          x: Number((xCenter + (rng() - 0.5) * jitter).toFixed(4)),
          y: Number((0.35 + shoulderYDelta * 0.9 + (rng() - 0.5) * jitter).toFixed(4)),
          isTracked: true,
          confidence: 0.94,
        },
        left_shoulder: {
          x: Number((xCenter - 0.1 + (rng() - 0.5) * jitter).toFixed(4)),
          y: Number(leftShoulderY.toFixed(4)),
          isTracked: true,
          confidence: 0.93,
        },
        right_shoulder: {
          x: Number((xCenter + 0.1 + (rng() - 0.5) * jitter).toFixed(4)),
          y: Number(rightShoulderY.toFixed(4)),
          isTracked: true,
          confidence: 0.93,
        },
        left_hand: {
          x: Number((xCenter - 0.14 + (rng() - 0.5) * jitter).toFixed(4)),
          y: Number(handY.toFixed(4)),
          isTracked: true,
          confidence: 0.92,
        },
        right_hand: {
          x: Number((xCenter + 0.14 + (rng() - 0.5) * jitter).toFixed(4)),
          y: Number(handY.toFixed(4)),
          isTracked: true,
          confidence: 0.92,
        },
      },
      expected: scenario.expected,
    });
  }

  return { name: scenario.name, frames };
}

export function buildPushupFixtureCorpus(): PushupFixtureTrace[] {
  const scenarios: Scenario[] = [
    {
      // 3 standard reps at normal tempo (~2s each)
      name: 'camera-facing',
      expected: { repCount: 3 },
      durationSec: 11.0,
      repWindowsSec: [
        { start: 1.0, end: 3.2 },
        { start: 4.0, end: 6.2 },
        { start: 7.0, end: 9.2 },
      ],
      baseElbowDeg: 156,
      elbowTravelDeg: 66, // 156 -> ~90 (full depth)
    },
    {
      // 2 reps from side angle -- slightly noisier
      name: 'side-angle',
      expected: { repCount: 2 },
      durationSec: 8.5,
      repWindowsSec: [
        { start: 1.2, end: 3.6 },
        { start: 4.8, end: 7.2 },
      ],
      baseElbowDeg: 154,
      elbowTravelDeg: 64, // 154 -> ~90
      noiseScaleDeg: 1.5,
    },
    {
      // 4 quick reps (~1.2s each)
      name: 'fast-reps',
      expected: { repCount: 4 },
      durationSec: 8.0,
      repWindowsSec: [
        { start: 0.8, end: 2.0 },
        { start: 2.4, end: 3.6 },
        { start: 4.0, end: 5.2 },
        { start: 5.6, end: 6.8 },
      ],
      baseElbowDeg: 155,
      elbowTravelDeg: 65,
      noiseScaleDeg: 1.3,
    },
    {
      // 2 reps with reduced depth (partial ROM)
      // elbowTravelDeg of 68 means minimum elbow ~88 -- just barely crosses
      // the 90 bottom threshold, so reps count but with shallow depth
      name: 'partial-rom',
      expected: { repCount: 2 },
      durationSec: 8.0,
      repWindowsSec: [
        { start: 1.0, end: 3.4 },
        { start: 4.4, end: 6.8 },
      ],
      baseElbowDeg: 156,
      elbowTravelDeg: 68, // 156 -> ~88 (just crosses 90 bottom threshold)
    },
  ];

  return scenarios.map((scenario, idx) => buildTrace(scenario, 7201 + idx * 83));
}
