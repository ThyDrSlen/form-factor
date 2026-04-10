/**
 * Squat Fixture Corpus
 *
 * Generates synthetic squat tracking traces for evaluation.
 * Mirrors the pullup-fixture-corpus pattern but uses knee/hip angles
 * as the primary signal, with hips moving DOWN on descent and UP on ascent.
 *
 * Thresholds sourced from lib/workouts/squat.ts:
 *   standing:     160  (nearly straight legs)
 *   descentStart: 145  (begin counting descent)
 *   parallel:      95  (hip crease at or below knee)
 *   deep:          80  (below parallel)
 *   ascent:       110  (transitioning up)
 *   finish:       155  (back to standing)
 */

export type SquatFixtureFrame = {
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

export type SquatFixtureTrace = {
  name: string;
  frames: SquatFixtureFrame[];
};

type Scenario = {
  name: string;
  expected: { repCount: number };
  durationSec: number;
  /** Each window defines one rep cycle: descent then ascent */
  repWindowsSec: Array<{ start: number; end: number; amplitude?: number }>;
  /** Knee angle at rest (standing) -- around 165 */
  baseKneeDeg: number;
  /** How far knee drops from base during a full rep (base - travel ~ bottom) */
  kneeTravelDeg: number;
  /** Hip angle at rest (standing tall) -- around 170 */
  baseHipDeg: number;
  /** How far hip drops from base during a full rep */
  hipTravelDeg: number;
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
    // sin(0..PI) gives 0->1->0 which maps to standing->bottom->standing
    return Math.sin(Math.PI * phase) * amplitude;
  }
  return 0;
}

function buildTrace(scenario: Scenario, seed: number): SquatFixtureTrace {
  const rng = makeRng(seed);
  const frames: SquatFixtureFrame[] = [];
  const count = Math.floor(scenario.durationSec * FPS);
  const noiseScale = scenario.noiseScaleDeg ?? 1.2;

  for (let index = 0; index < count; index += 1) {
    const timestampSec = Number((index * DT_SEC).toFixed(3));
    const rep = repSignal(timestampSec, scenario.repWindowsSec);
    const noise = () => (rng() - 0.5) * 2 * noiseScale;

    // Knee: drops from base (~165) by travel (~80) at peak rep signal
    const kneeCenter = scenario.baseKneeDeg - scenario.kneeTravelDeg * rep;
    const leftKnee = Number((kneeCenter + noise()).toFixed(2));
    const rightKnee = Number((kneeCenter + noise()).toFixed(2));

    // Hip: drops from base (~170) by travel (~85) at peak rep signal
    const hipCenter = scenario.baseHipDeg - scenario.hipTravelDeg * rep;
    const leftHip = Number((hipCenter + noise()).toFixed(2));
    const rightHip = Number((hipCenter + noise()).toFixed(2));

    // Arms stay relatively static during squats (holding bar or at sides)
    const elbowBase = 160 + Math.sin(timestampSec * 0.8) * 2;
    const shoulderBase = 45 + Math.sin(timestampSec * 0.6) * 3;
    const leftElbow = Number((elbowBase + noise() * 0.3).toFixed(2));
    const rightElbow = Number((elbowBase + noise() * 0.3).toFixed(2));
    const leftShoulder = Number((shoulderBase + noise() * 0.4).toFixed(2));
    const rightShoulder = Number((shoulderBase + noise() * 0.4).toFixed(2));

    // Hip Y position: starts around 0.45 at standing, drops to ~0.60-0.65 at bottom
    const jitter = 0.004;
    const xCenter = scenario.name === 'back-facing' ? 0.56 : 0.5;
    const hipY = 0.45 + rep * 0.18 + (rng() - 0.5) * jitter;

    frames.push({
      timestampSec,
      angles: {
        leftKnee,
        rightKnee,
        leftElbow,
        rightElbow,
        leftHip,
        rightHip,
        leftShoulder,
        rightShoulder,
      },
      joints: {
        head: {
          x: Number((xCenter + (rng() - 0.5) * jitter).toFixed(4)),
          y: Number((0.18 + rep * 0.12).toFixed(4)),
          isTracked: true,
          confidence: 0.95,
        },
        left_hip: {
          x: Number((xCenter - 0.08 + (rng() - 0.5) * jitter).toFixed(4)),
          y: Number(hipY.toFixed(4)),
          isTracked: true,
          confidence: 0.93,
        },
        right_hip: {
          x: Number((xCenter + 0.08 + (rng() - 0.5) * jitter).toFixed(4)),
          y: Number(hipY.toFixed(4)),
          isTracked: true,
          confidence: 0.93,
        },
        left_knee: {
          x: Number((xCenter - 0.09 + (rng() - 0.5) * jitter).toFixed(4)),
          y: Number((0.65 + rep * 0.05).toFixed(4)),
          isTracked: true,
          confidence: 0.92,
        },
        right_knee: {
          x: Number((xCenter + 0.09 + (rng() - 0.5) * jitter).toFixed(4)),
          y: Number((0.65 + rep * 0.05).toFixed(4)),
          isTracked: true,
          confidence: 0.92,
        },
        left_ankle: {
          x: Number((xCenter - 0.09 + (rng() - 0.5) * jitter).toFixed(4)),
          y: 0.88,
          isTracked: true,
          confidence: 0.90,
        },
        right_ankle: {
          x: Number((xCenter + 0.09 + (rng() - 0.5) * jitter).toFixed(4)),
          y: 0.88,
          isTracked: true,
          confidence: 0.90,
        },
      },
      expected: scenario.expected,
    });
  }

  return { name: scenario.name, frames };
}

export function buildSquatFixtureCorpus(): SquatFixtureTrace[] {
  const scenarios: Scenario[] = [
    {
      // 3 standard reps, camera facing, full ROM (standing 165 -> bottom ~85)
      name: 'camera-facing',
      expected: { repCount: 3 },
      durationSec: 12.0,
      repWindowsSec: [
        { start: 1.0, end: 3.2 },
        { start: 4.0, end: 6.2 },
        { start: 7.0, end: 9.2 },
      ],
      baseKneeDeg: 165,
      kneeTravelDeg: 80,
      baseHipDeg: 170,
      hipTravelDeg: 85,
    },
    {
      // 2 reps, back to camera -- slightly noisier
      name: 'back-facing',
      expected: { repCount: 2 },
      durationSec: 9.5,
      repWindowsSec: [
        { start: 1.5, end: 3.8 },
        { start: 5.0, end: 7.3 },
      ],
      baseKneeDeg: 164,
      kneeTravelDeg: 78,
      baseHipDeg: 168,
      hipTravelDeg: 82,
      noiseScaleDeg: 1.6,
    },
    {
      // 3 reps that never reach parallel (knee bottoms at ~115, above the 95 threshold)
      // Should still count as 3 reps even without full depth
      name: 'partial-rom',
      expected: { repCount: 3 },
      durationSec: 12.0,
      repWindowsSec: [
        { start: 1.0, end: 3.0 },
        { start: 4.0, end: 6.0 },
        { start: 7.0, end: 9.0 },
      ],
      baseKneeDeg: 165,
      kneeTravelDeg: 50, // Only drops to ~115, well above parallel (95)
      baseHipDeg: 170,
      hipTravelDeg: 55,
    },
    {
      // 2 slow reps (~3.5s each), heavier load, controlled tempo
      name: 'heavy-slow',
      expected: { repCount: 2 },
      durationSec: 12.0,
      repWindowsSec: [
        { start: 1.5, end: 5.0 },  // 3.5s rep
        { start: 6.5, end: 10.0 }, // 3.5s rep
      ],
      baseKneeDeg: 163,
      kneeTravelDeg: 78,
      baseHipDeg: 168,
      hipTravelDeg: 83,
      noiseScaleDeg: 0.9, // Less noise -- more controlled movement
    },
  ];

  return scenarios.map((scenario, idx) => buildTrace(scenario, 7203 + idx * 113));
}
