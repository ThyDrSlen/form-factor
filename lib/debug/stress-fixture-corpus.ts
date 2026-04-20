import type { PullupFixtureFrame } from './pullup-fixture-corpus';

export type StressFixtureTrace = {
  name: string;
  frames: PullupFixtureFrame[];
  /** What this scenario tests */
  category: 'non-human' | 'subject-switch' | 'extreme-angle' | 'partial-body' | 'tracking-quality';
  /** Human-readable description */
  description: string;
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

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Default joint layout for a person hanging from a bar (front-facing). */
function baseHangingJoints(xCenter: number, jitter: number, rng: () => number) {
  return {
    head: { x: r4(xCenter + jit(rng, jitter)), y: 0.34, isTracked: true, confidence: 0.95 },
    neck: { x: r4(xCenter + jit(rng, jitter)), y: 0.39, isTracked: true, confidence: 0.94 },
    left_shoulder: { x: r4(xCenter - 0.1 + jit(rng, jitter)), y: 0.45, isTracked: true, confidence: 0.93 },
    right_shoulder: { x: r4(xCenter + 0.1 + jit(rng, jitter)), y: 0.45, isTracked: true, confidence: 0.93 },
    left_hand: { x: r4(xCenter - 0.16 + jit(rng, jitter)), y: 0.61, isTracked: true, confidence: 0.92 },
    right_hand: { x: r4(xCenter + 0.16 + jit(rng, jitter)), y: 0.61, isTracked: true, confidence: 0.92 },
    left_hip: { x: r4(xCenter - 0.08 + jit(rng, jitter)), y: 0.68, isTracked: true, confidence: 0.91 },
    right_hip: { x: r4(xCenter + 0.08 + jit(rng, jitter)), y: 0.68, isTracked: true, confidence: 0.91 },
    left_knee: { x: r4(xCenter - 0.07 + jit(rng, jitter)), y: 0.82, isTracked: true, confidence: 0.90 },
    right_knee: { x: r4(xCenter + 0.07 + jit(rng, jitter)), y: 0.82, isTracked: true, confidence: 0.90 },
  };
}
function r4(v: number): number {
  return Number(v.toFixed(4));
}

function jit(rng: () => number, scale: number): number {
  return (rng() - 0.5) * scale;
}

/** Generate a sin-wave rep signal in [0,1] during the given window, 0 outside. */
function repSignal(
  ts: number,
  windows: { start: number; end: number; amplitude?: number }[],
): number {
  for (const w of windows) {
    if (ts < w.start || ts > w.end) continue;
    const phase = (ts - w.start) / Math.max(1e-6, w.end - w.start);
    const amp = w.amplitude ?? 1;
    return Math.sin(Math.PI * phase) * amp;
  }
  return 0;
}

/**
 * Build a "normal" rep frame: person hanging from a bar doing a pullup.
 * rep signal 0 = dead-hang, 1 = chin-over-bar.
 */
function normalRepFrame(
  ts: number,
  rep: number,
  rng: () => number,
  opts?: { xCenter?: number; shoulderWidth?: number; noiseScale?: number },
): PullupFixtureFrame {
  const xCenter = opts?.xCenter ?? 0.5;
  const sw = opts?.shoulderWidth ?? 0.1;
  const noiseScale = opts?.noiseScale ?? 1.1;
  const noise = () => (rng() - 0.5) * 2 * noiseScale;
  const jitter = 0.004;

  const elbowCenter = 156 - 80 * rep;
  const shoulderAngle = 92 - rep * 18;
  const hipBase = 146 + Math.sin(ts * 1.4) * 2;
  const kneeBase = 127 + Math.sin(ts * 1.1) * 1.8;

  const shoulderYDisp = rep * 0.18;
  const hipYDisp = rep * 0.12;
  const handTravel = 0.17 + 0.18 * rep;
  const yNoise = () => (rng() - 0.5) * 2 * noiseScale * 0.001;

  return {
    timestampSec: r4(ts),
    angles: {
      leftKnee: r4(kneeBase + noise() * 0.5),
      rightKnee: r4(kneeBase + noise() * 0.5),
      leftElbow: r4(elbowCenter + noise()),
      rightElbow: r4(elbowCenter + noise()),
      leftHip: r4(hipBase + noise() * 0.35),
      rightHip: r4(hipBase + noise() * 0.35),
      leftShoulder: r4(shoulderAngle + (rng() - 0.5) * 1.4),
      rightShoulder: r4(shoulderAngle + (rng() - 0.5) * 1.4),
    },
    joints: {
      head: { x: r4(xCenter + jit(rng, jitter)), y: r4(0.34 - shoulderYDisp + yNoise()), isTracked: true, confidence: 0.95 },
      neck: { x: r4(xCenter + jit(rng, jitter)), y: r4(0.39 - shoulderYDisp + yNoise()), isTracked: true, confidence: 0.94 },
      left_shoulder: { x: r4(xCenter - sw + jit(rng, jitter)), y: r4(0.45 - shoulderYDisp + yNoise()), isTracked: true, confidence: 0.93 },
      right_shoulder: { x: r4(xCenter + sw + jit(rng, jitter)), y: r4(0.45 - shoulderYDisp + yNoise()), isTracked: true, confidence: 0.93 },
      left_hand: { x: r4(xCenter - 0.16 + jit(rng, jitter)), y: r4(0.61 - handTravel + jit(rng, jitter)), isTracked: true, confidence: 0.92 },
      right_hand: { x: r4(xCenter + 0.16 + jit(rng, jitter)), y: r4(0.61 - handTravel + jit(rng, jitter)), isTracked: true, confidence: 0.92 },
      left_hip: { x: r4(xCenter - 0.08 + jit(rng, jitter)), y: r4(0.68 - hipYDisp + yNoise()), isTracked: true, confidence: 0.91 },
      right_hip: { x: r4(xCenter + 0.08 + jit(rng, jitter)), y: r4(0.68 - hipYDisp + yNoise()), isTracked: true, confidence: 0.91 },
      left_knee: { x: r4(xCenter - 0.07 + jit(rng, jitter)), y: r4(0.82 - hipYDisp * 0.5 + yNoise()), isTracked: true, confidence: 0.90 },
      right_knee: { x: r4(xCenter + 0.07 + jit(rng, jitter)), y: r4(0.82 - hipYDisp * 0.5 + yNoise()), isTracked: true, confidence: 0.90 },
    },
    expected: { repCount: 0 }, // overwritten by caller
  };
}

/** Build an untracked frame (all joints isTracked=false, low confidence). */
function untrackedFrame(ts: number, rng: () => number): PullupFixtureFrame {
  const joints: Record<string, { x: number; y: number; isTracked: boolean; confidence: number }> = {};
  for (const name of ['head', 'neck', 'left_shoulder', 'right_shoulder', 'left_hand', 'right_hand', 'left_hip', 'right_hip', 'left_knee', 'right_knee']) {
    joints[name] = { x: r4(rng()), y: r4(rng()), isTracked: false, confidence: r4(rng() * 0.2) };
  }
  return {
    timestampSec: r4(ts),
    angles: {
      leftKnee: 180, rightKnee: 180,
      leftElbow: 180, rightElbow: 180,
      leftHip: 180, rightHip: 180,
      leftShoulder: 90, rightShoulder: 90,
    },
    joints,
    expected: { repCount: 0 },
  };
}

// ---------------------------------------------------------------------------
// Scenario builders
// ---------------------------------------------------------------------------

function buildSkeletonOnObject(rng: () => number): StressFixtureTrace {
  const frames: PullupFixtureFrame[] = [];
  const count = 5 * FPS; // 150 frames
  const flatY = 0.5;

  for (let i = 0; i < count; i++) {
    const ts = i * DT_SEC;
    // Tiny noise < 0.0005
    const n = () => (rng() - 0.5) * 0.0009;

    frames.push({
      timestampSec: r4(ts),
      angles: {
        leftKnee: r4(180 + n() * 100),
        rightKnee: r4(180 + n() * 100),
        leftElbow: r4(180 + n() * 100),
        rightElbow: r4(180 + n() * 100),
        leftHip: r4(180 + n() * 100),
        rightHip: r4(180 + n() * 100),
        leftShoulder: r4(180 + n() * 100),
        rightShoulder: r4(180 + n() * 100),
      },
      joints: {
        head: { x: r4(0.5 + n()), y: r4(flatY + n()), isTracked: true, confidence: 0.88 },
        neck: { x: r4(0.5 + n()), y: r4(flatY + n()), isTracked: true, confidence: 0.87 },
        left_shoulder: { x: r4(0.35 + n()), y: r4(flatY + n()), isTracked: true, confidence: 0.85 },
        right_shoulder: { x: r4(0.65 + n()), y: r4(flatY + n()), isTracked: true, confidence: 0.85 },
        left_hand: { x: r4(0.15 + n()), y: r4(flatY + n()), isTracked: true, confidence: 0.83 },
        right_hand: { x: r4(0.85 + n()), y: r4(flatY + n()), isTracked: true, confidence: 0.83 },
        left_hip: { x: r4(0.4 + n()), y: r4(flatY + n()), isTracked: true, confidence: 0.84 },
        right_hip: { x: r4(0.6 + n()), y: r4(flatY + n()), isTracked: true, confidence: 0.84 },
        left_knee: { x: r4(0.38 + n()), y: r4(flatY + n()), isTracked: true, confidence: 0.82 },
        right_knee: { x: r4(0.62 + n()), y: r4(flatY + n()), isTracked: true, confidence: 0.82 },
      },
      expected: { repCount: 0 },
    });
  }

  return {
    name: 'skeleton-on-object',
    frames,
    category: 'non-human',
    description: 'Skeleton placed on a static inanimate object (e.g. mat). All joints at same Y level, zero meaningful movement, fully extended angles. Should be rejected as non-human.',
  };
}

function buildSkeletonOnObjectCrucifix(rng: () => number): StressFixtureTrace {
  const frames: PullupFixtureFrame[] = [];
  const count = 4 * FPS; // 120 frames
  const flatY = 0.5;

  for (let i = 0; i < count; i++) {
    const ts = i * DT_SEC;
    const n = () => (rng() - 0.5) * 0.0009;
    const yJitter = () => (rng() - 0.5) * 0.02; // Y within flatY +/- 0.01

    frames.push({
      timestampSec: r4(ts),
      angles: {
        leftKnee: r4(180 + n() * 100),
        rightKnee: r4(180 + n() * 100),
        leftElbow: r4(175 + (rng() - 0.5) * 2),
        rightElbow: r4(175 + (rng() - 0.5) * 2),
        leftHip: r4(180 + n() * 100),
        rightHip: r4(180 + n() * 100),
        leftShoulder: r4(90 + (rng() - 0.5) * 2),
        rightShoulder: r4(90 + (rng() - 0.5) * 2),
      },
      joints: {
        head: { x: r4(0.5 + n()), y: r4(flatY + yJitter()), isTracked: true, confidence: 0.87 },
        neck: { x: r4(0.5 + n()), y: r4(flatY + yJitter()), isTracked: true, confidence: 0.86 },
        left_shoulder: { x: r4(0.35 + n()), y: r4(flatY + yJitter()), isTracked: true, confidence: 0.85 },
        right_shoulder: { x: r4(0.65 + n()), y: r4(flatY + yJitter()), isTracked: true, confidence: 0.85 },
        left_hand: { x: r4(0.1 + n()), y: r4(flatY + yJitter()), isTracked: true, confidence: 0.83 },
        right_hand: { x: r4(0.9 + n()), y: r4(flatY + yJitter()), isTracked: true, confidence: 0.83 },
        left_hip: { x: r4(0.42 + n()), y: r4(flatY + yJitter()), isTracked: true, confidence: 0.84 },
        right_hip: { x: r4(0.58 + n()), y: r4(flatY + yJitter()), isTracked: true, confidence: 0.84 },
        left_knee: { x: r4(0.4 + n()), y: r4(flatY + yJitter()), isTracked: true, confidence: 0.82 },
        right_knee: { x: r4(0.6 + n()), y: r4(flatY + yJitter()), isTracked: true, confidence: 0.82 },
      },
      expected: { repCount: 0 },
    });
  }

  return {
    name: 'skeleton-on-object-crucifix',
    frames,
    category: 'non-human',
    description: 'T-pose on a flat surface ("crucifix on mat"). Arms fully outstretched left/right, all Y coords roughly equal, elbows ~175, shoulders ~90, knees ~180. No vertical variation. Should be rejected as non-human.',
  };
}

function buildPersonWalkthroughBrief(rng: () => number): StressFixtureTrace {
  const frames: PullupFixtureFrame[] = [];
  const count = 10 * FPS; // 300 frames
  const repWindows = [
    { start: 1.0, end: 3.5 },
    { start: 6.0, end: 8.5 },
  ];
  const walkthroughStart = 4.0;
  const walkthroughEnd = 5.5;

  // Original person: xCenter=0.5, shoulderWidth=0.1
  // Walker: xCenter=0.7, shoulderWidth=0.14 (different build)

  for (let i = 0; i < count; i++) {
    const ts = i * DT_SEC;
    const inWalkthrough = ts >= walkthroughStart && ts <= walkthroughEnd;

    if (inWalkthrough) {
      // Walker skeleton: different centroid, different proportions, neutral angles
      const walkerX = 0.7 + (rng() - 0.5) * 0.006;
      const walkerSW = 0.14;
      const walkPhase = (ts - walkthroughStart) / (walkthroughEnd - walkthroughStart);
      // Walker moves slightly across frame
      const walkerDrift = walkPhase * 0.05;
      const wx = walkerX + walkerDrift;

      frames.push({
        timestampSec: r4(ts),
        angles: {
          leftKnee: r4(155 + (rng() - 0.5) * 4),
          rightKnee: r4(155 + (rng() - 0.5) * 4),
          leftElbow: r4(160 + (rng() - 0.5) * 6),
          rightElbow: r4(160 + (rng() - 0.5) * 6),
          leftHip: r4(165 + (rng() - 0.5) * 4),
          rightHip: r4(165 + (rng() - 0.5) * 4),
          leftShoulder: r4(150 + (rng() - 0.5) * 8),
          rightShoulder: r4(150 + (rng() - 0.5) * 8),
        },
        joints: {
          head: { x: r4(wx), y: r4(0.28 + jit(rng, 0.006)), isTracked: true, confidence: 0.89 },
          neck: { x: r4(wx), y: r4(0.33 + jit(rng, 0.006)), isTracked: true, confidence: 0.88 },
          left_shoulder: { x: r4(wx - walkerSW + jit(rng, 0.005)), y: r4(0.38 + jit(rng, 0.005)), isTracked: true, confidence: 0.87 },
          right_shoulder: { x: r4(wx + walkerSW + jit(rng, 0.005)), y: r4(0.38 + jit(rng, 0.005)), isTracked: true, confidence: 0.87 },
          left_hand: { x: r4(wx - 0.12 + jit(rng, 0.005)), y: r4(0.55 + jit(rng, 0.005)), isTracked: true, confidence: 0.85 },
          right_hand: { x: r4(wx + 0.12 + jit(rng, 0.005)), y: r4(0.55 + jit(rng, 0.005)), isTracked: true, confidence: 0.85 },
          left_hip: { x: r4(wx - 0.09 + jit(rng, 0.005)), y: r4(0.58 + jit(rng, 0.005)), isTracked: true, confidence: 0.84 },
          right_hip: { x: r4(wx + 0.09 + jit(rng, 0.005)), y: r4(0.58 + jit(rng, 0.005)), isTracked: true, confidence: 0.84 },
          left_knee: { x: r4(wx - 0.08 + jit(rng, 0.005)), y: r4(0.74 + jit(rng, 0.005)), isTracked: true, confidence: 0.82 },
          right_knee: { x: r4(wx + 0.08 + jit(rng, 0.005)), y: r4(0.74 + jit(rng, 0.005)), isTracked: true, confidence: 0.82 },
        },
        expected: { repCount: 2 },
      });
    } else {
      // Original person doing reps
      const rep = repSignal(ts, repWindows);
      const frame = normalRepFrame(ts, rep, rng);
      frame.expected = { repCount: 2 };
      frames.push(frame);
    }
  }

  return {
    name: 'person-walkthrough-brief',
    frames,
    category: 'subject-switch',
    description: 'Person does a pullup rep (0-4s), someone walks through frame (4-5.5s causing centroid jump of 0.2+ and different shoulder width), then original person resumes and completes another rep (5.5-10s). Walkthrough period should be ignored; 2 reps expected.',
  };
}

function buildPersonWalkthroughSteals(rng: () => number): StressFixtureTrace {
  const frames: PullupFixtureFrame[] = [];
  const count = 8 * FPS; // 240 frames
  const repWindow = [{ start: 1.0, end: 2.8 }];
  const switchTime = 3.0;

  // Walker's fake "rep-like" arm movement window
  const fakeRepWindow = [{ start: 4.5, end: 6.5, amplitude: 0.7 }];

  for (let i = 0; i < count; i++) {
    const ts = i * DT_SEC;

    if (ts < switchTime) {
      // Original person
      const rep = repSignal(ts, repWindow);
      const frame = normalRepFrame(ts, rep, rng);
      frame.expected = { repCount: 1 };
      frames.push(frame);
    } else {
      // Walker has taken over: different centroid (0.65), wider shoulders (0.13)
      const walkerX = 0.65;
      const walkerSW = 0.13;
      const fakeRep = repSignal(ts, fakeRepWindow);
      // Walker does vague arm movements, not real pullups
      const elbowAngle = 145 - fakeRep * 30; // much less range than a real pullup (30 vs 80)

      frames.push({
        timestampSec: r4(ts),
        angles: {
          leftKnee: r4(162 + (rng() - 0.5) * 3),
          rightKnee: r4(162 + (rng() - 0.5) * 3),
          leftElbow: r4(elbowAngle + (rng() - 0.5) * 4),
          rightElbow: r4(elbowAngle + (rng() - 0.5) * 4),
          leftHip: r4(170 + (rng() - 0.5) * 3),
          rightHip: r4(170 + (rng() - 0.5) * 3),
          leftShoulder: r4(110 - fakeRep * 10 + (rng() - 0.5) * 3),
          rightShoulder: r4(110 - fakeRep * 10 + (rng() - 0.5) * 3),
        },
        joints: {
          head: { x: r4(walkerX + jit(rng, 0.005)), y: r4(0.30 - fakeRep * 0.04 + jit(rng, 0.004)), isTracked: true, confidence: 0.88 },
          neck: { x: r4(walkerX + jit(rng, 0.005)), y: r4(0.35 - fakeRep * 0.04 + jit(rng, 0.004)), isTracked: true, confidence: 0.87 },
          left_shoulder: { x: r4(walkerX - walkerSW + jit(rng, 0.005)), y: r4(0.40 - fakeRep * 0.04 + jit(rng, 0.004)), isTracked: true, confidence: 0.86 },
          right_shoulder: { x: r4(walkerX + walkerSW + jit(rng, 0.005)), y: r4(0.40 - fakeRep * 0.04 + jit(rng, 0.004)), isTracked: true, confidence: 0.86 },
          left_hand: { x: r4(walkerX - 0.14 + jit(rng, 0.005)), y: r4(0.56 - fakeRep * 0.06 + jit(rng, 0.004)), isTracked: true, confidence: 0.84 },
          right_hand: { x: r4(walkerX + 0.14 + jit(rng, 0.005)), y: r4(0.56 - fakeRep * 0.06 + jit(rng, 0.004)), isTracked: true, confidence: 0.84 },
          left_hip: { x: r4(walkerX - 0.09 + jit(rng, 0.005)), y: r4(0.60 + jit(rng, 0.004)), isTracked: true, confidence: 0.83 },
          right_hip: { x: r4(walkerX + 0.09 + jit(rng, 0.005)), y: r4(0.60 + jit(rng, 0.004)), isTracked: true, confidence: 0.83 },
          left_knee: { x: r4(walkerX - 0.08 + jit(rng, 0.005)), y: r4(0.76 + jit(rng, 0.004)), isTracked: true, confidence: 0.81 },
          right_knee: { x: r4(walkerX + 0.08 + jit(rng, 0.005)), y: r4(0.76 + jit(rng, 0.004)), isTracked: true, confidence: 0.81 },
        },
        expected: { repCount: 1 },
      });
    }
  }

  return {
    name: 'person-walkthrough-steals',
    frames,
    category: 'subject-switch',
    description: 'Person does one rep (0-3s), then a walker enters at 3s and stays permanently. Walker has different centroid (0.65 vs 0.5) and wider shoulders (0.13 vs 0.1). Walker does vague arm movements that look like a partial rep. Only the original person\'s 1 rep should count.',
  };
}

function buildSubjectSwitchAndReturn(rng: () => number): StressFixtureTrace {
  const frames: PullupFixtureFrame[] = [];
  const count = 15 * FPS; // 450 frames

  // Original person reps at xCenter=0.5, shoulderWidth=0.1
  const origRepWindows = [
    { start: 1.0, end: 3.5 },
    { start: 10.0, end: 12.5 },
  ];
  // New person at xCenter=0.45, shoulderWidth=0.13 (1.3x wider)
  const newPersonRepWindow = [{ start: 5.5, end: 7.5, amplitude: 0.85 }];

  // Tracking loss periods
  const lostPeriod1Start = 4.0;
  const lostPeriod1End = 5.0;
  const lostPeriod2Start = 8.0;
  const lostPeriod2End = 9.0;

  // New person period
  const newPersonStart = 5.0;
  const newPersonEnd = 8.0;

  for (let i = 0; i < count; i++) {
    const ts = i * DT_SEC;
    const inLost1 = ts >= lostPeriod1Start && ts < lostPeriod1End;
    const inLost2 = ts >= lostPeriod2Start && ts < lostPeriod2End;
    const inNewPerson = ts >= newPersonStart && ts < newPersonEnd && !inLost2;

    if (inLost1 || inLost2) {
      // Full tracking loss
      const frame = untrackedFrame(ts, rng);
      frame.expected = { repCount: 2 };
      frames.push(frame);
    } else if (inNewPerson) {
      // Different person: wider shoulders (1.3x), shifted left
      const rep = repSignal(ts, newPersonRepWindow);
      const frame = normalRepFrame(ts, rep, rng, {
        xCenter: 0.45,
        shoulderWidth: 0.13,
      });
      frame.expected = { repCount: 2 };
      frames.push(frame);
    } else {
      // Original person
      const rep = repSignal(ts, origRepWindows);
      const frame = normalRepFrame(ts, rep, rng);
      frame.expected = { repCount: 2 };
      frames.push(frame);
    }
  }

  return {
    name: 'subject-switch-and-return',
    frames,
    category: 'subject-switch',
    description: 'Original person does rep (0-4s), tracking lost (4-5s), new person with 1.3x shoulder width appears and moves (5-8s), tracking lost again (8-9s), original returns and does another rep (9-15s). Only 2 reps from the original person should count.',
  };
}

function buildExtremeObliqueSide(rng: () => number): StressFixtureTrace {
  const frames: PullupFixtureFrame[] = [];
  const count = 8 * FPS; // 240 frames
  const repWindow = [{ start: 2.0, end: 5.0 }];

  // At ~80 deg side angle, left/right joints nearly overlap in X.
  // Shoulder "width" in screen space < 0.03.
  const xCenter = 0.5;
  const compressedWidth = 0.012; // extremely compressed lateral

  for (let i = 0; i < count; i++) {
    const ts = i * DT_SEC;
    const rep = repSignal(ts, repWindow);
    const noise = () => (rng() - 0.5) * 2 * 1.6; // slightly more noise due to angle
    const jitter = 0.005;

    // Y motion is still visible even from side
    const shoulderYDisp = rep * 0.18;
    const hipYDisp = rep * 0.12;
    const handTravel = 0.17 + 0.18 * rep;
    const yNoise = () => (rng() - 0.5) * 0.003;

    // Elbows are harder to resolve from side, but still produce some angle change
    const elbowCenter = 156 - 55 * rep; // reduced range due to viewing angle
    const shoulderAngle = 92 - rep * 12;

    frames.push({
      timestampSec: r4(ts),
      angles: {
        leftKnee: r4(127 + noise() * 0.5),
        rightKnee: r4(127 + noise() * 0.5),
        leftElbow: r4(elbowCenter + noise()),
        rightElbow: r4(elbowCenter + noise()),
        leftHip: r4(146 + noise() * 0.35),
        rightHip: r4(146 + noise() * 0.35),
        leftShoulder: r4(shoulderAngle + (rng() - 0.5) * 2),
        rightShoulder: r4(shoulderAngle + (rng() - 0.5) * 2),
      },
      joints: {
        head: { x: r4(xCenter + jit(rng, jitter)), y: r4(0.34 - shoulderYDisp + yNoise()), isTracked: true, confidence: 0.82 },
        neck: { x: r4(xCenter + jit(rng, jitter)), y: r4(0.39 - shoulderYDisp + yNoise()), isTracked: true, confidence: 0.81 },
        // Left and right nearly overlapping in X (depth compression at ~80deg)
        left_shoulder: { x: r4(xCenter - compressedWidth + jit(rng, jitter)), y: r4(0.45 - shoulderYDisp + yNoise()), isTracked: true, confidence: 0.78 },
        right_shoulder: { x: r4(xCenter + compressedWidth + jit(rng, jitter)), y: r4(0.45 - shoulderYDisp + yNoise()), isTracked: true, confidence: 0.78 },
        left_hand: { x: r4(xCenter - 0.02 + jit(rng, jitter)), y: r4(0.61 - handTravel + jit(rng, jitter)), isTracked: true, confidence: 0.75 },
        right_hand: { x: r4(xCenter + 0.02 + jit(rng, jitter)), y: r4(0.61 - handTravel + jit(rng, jitter)), isTracked: true, confidence: 0.75 },
        left_hip: { x: r4(xCenter - compressedWidth * 0.8 + jit(rng, jitter)), y: r4(0.68 - hipYDisp + yNoise()), isTracked: true, confidence: 0.77 },
        right_hip: { x: r4(xCenter + compressedWidth * 0.8 + jit(rng, jitter)), y: r4(0.68 - hipYDisp + yNoise()), isTracked: true, confidence: 0.77 },
        left_knee: { x: r4(xCenter - compressedWidth * 0.7 + jit(rng, jitter)), y: r4(0.82 - hipYDisp * 0.5 + yNoise()), isTracked: true, confidence: 0.74 },
        right_knee: { x: r4(xCenter + compressedWidth * 0.7 + jit(rng, jitter)), y: r4(0.82 - hipYDisp * 0.5 + yNoise()), isTracked: true, confidence: 0.74 },
      },
      expected: { repCount: 1 },
    });
  }

  return {
    name: 'extreme-oblique-side',
    frames,
    category: 'extreme-angle',
    description: 'Camera at ~80 degrees side angle. Left/right joints nearly overlapping in X (shoulder width < 0.03 in screen space). One normal rep still visible via Y oscillation. Should detect 1 rep via vertical displacement despite extreme angle.',
  };
}

function buildPartialBodyUpperOnly(rng: () => number): StressFixtureTrace {
  const frames: PullupFixtureFrame[] = [];
  const count = 7 * FPS; // 210 frames
  const repWindow = [{ start: 2.0, end: 5.0 }];
  const xCenter = 0.5;

  for (let i = 0; i < count; i++) {
    const ts = i * DT_SEC;
    const rep = repSignal(ts, repWindow);
    const noise = () => (rng() - 0.5) * 2 * 1.1;
    const jitter = 0.004;

    const elbowCenter = 156 - 80 * rep;
    const shoulderAngle = 92 - rep * 18;
    const shoulderYDisp = rep * 0.18;
    const handTravel = 0.17 + 0.18 * rep;
    const yNoise = () => (rng() - 0.5) * 0.002;

    frames.push({
      timestampSec: r4(ts),
      angles: {
        // Knee and hip angles are garbage since lower body isn't tracked
        leftKnee: r4(180 + (rng() - 0.5) * 5),
        rightKnee: r4(180 + (rng() - 0.5) * 5),
        leftElbow: r4(elbowCenter + noise()),
        rightElbow: r4(elbowCenter + noise()),
        leftHip: r4(180 + (rng() - 0.5) * 5),
        rightHip: r4(180 + (rng() - 0.5) * 5),
        leftShoulder: r4(shoulderAngle + (rng() - 0.5) * 1.4),
        rightShoulder: r4(shoulderAngle + (rng() - 0.5) * 1.4),
      },
      joints: {
        // Upper body: tracked normally
        head: { x: r4(xCenter + jit(rng, jitter)), y: r4(0.34 - shoulderYDisp + yNoise()), isTracked: true, confidence: 0.95 },
        neck: { x: r4(xCenter + jit(rng, jitter)), y: r4(0.39 - shoulderYDisp + yNoise()), isTracked: true, confidence: 0.94 },
        left_shoulder: { x: r4(xCenter - 0.1 + jit(rng, jitter)), y: r4(0.45 - shoulderYDisp + yNoise()), isTracked: true, confidence: 0.93 },
        right_shoulder: { x: r4(xCenter + 0.1 + jit(rng, jitter)), y: r4(0.45 - shoulderYDisp + yNoise()), isTracked: true, confidence: 0.93 },
        left_hand: { x: r4(xCenter - 0.16 + jit(rng, jitter)), y: r4(0.61 - handTravel + jit(rng, jitter)), isTracked: true, confidence: 0.92 },
        right_hand: { x: r4(xCenter + 0.16 + jit(rng, jitter)), y: r4(0.61 - handTravel + jit(rng, jitter)), isTracked: true, confidence: 0.92 },
        // Lower body: NOT tracked
        left_hip: { x: r4(rng()), y: r4(rng()), isTracked: false, confidence: r4(rng() * 0.15) },
        right_hip: { x: r4(rng()), y: r4(rng()), isTracked: false, confidence: r4(rng() * 0.15) },
        left_knee: { x: r4(rng()), y: r4(rng()), isTracked: false, confidence: r4(rng() * 0.12) },
        right_knee: { x: r4(rng()), y: r4(rng()), isTracked: false, confidence: r4(rng() * 0.12) },
      },
      expected: { repCount: 1 },
    });
  }

  return {
    name: 'partial-body-upper-only',
    frames,
    category: 'partial-body',
    description: 'Only upper body tracked (head, neck, shoulders, elbows, hands). Hips and knees isTracked=false throughout. One rep with normal elbow/shoulder motion. Upper body should be sufficient for pullup detection (1 rep expected).',
  };
}

function buildTrackingFlicker(rng: () => number): StressFixtureTrace {
  const frames: PullupFixtureFrame[] = [];
  const count = 6 * FPS; // 180 frames
  const repWindow = [{ start: 1.5, end: 4.5 }];

  // Pattern: 2-3 frames on, 1-2 frames off, repeating
  // We use the PRNG to generate a deterministic on/off pattern
  const flickerPattern: boolean[] = [];
  let onCount = 0;
  let offCount = 0;
  let inOnPhase = true;
  const patternRng = makeRng(55555); // separate seed for pattern
  for (let i = 0; i < count; i++) {
    if (inOnPhase) {
      flickerPattern.push(true);
      onCount++;
      const targetOn = 2 + Math.floor(patternRng() * 2); // 2-3
      if (onCount >= targetOn) {
        inOnPhase = false;
        onCount = 0;
      }
    } else {
      flickerPattern.push(false);
      offCount++;
      const targetOff = 1 + Math.floor(patternRng() * 2); // 1-2
      if (offCount >= targetOff) {
        inOnPhase = true;
        offCount = 0;
      }
    }
  }

  for (let i = 0; i < count; i++) {
    const ts = i * DT_SEC;
    const tracked = flickerPattern[i];
    const rep = repSignal(ts, repWindow);

    if (tracked) {
      const frame = normalRepFrame(ts, rep, rng);
      frame.expected = { repCount: 1 };
      frames.push(frame);
    } else {
      const frame = untrackedFrame(ts, rng);
      frame.expected = { repCount: 1 };
      frames.push(frame);
    }
  }

  return {
    name: 'tracking-flicker',
    frames,
    category: 'tracking-quality',
    description: 'Tracking rapidly flickers on/off (2-3 frames tracked, 1-2 frames untracked, repeating). During tracked frames a rep is in progress. Detector should accumulate rep signal through flicker gaps (1 rep expected).',
  };
}

function buildCrowdNoise(rng: () => number): StressFixtureTrace {
  const frames: PullupFixtureFrame[] = [];
  const count = 10 * FPS; // 300 frames
  const repWindows = [
    { start: 1.0, end: 3.5 },
    { start: 5.5, end: 8.0 },
  ];

  // Noise spike positions: every ~50 frames, lasting 3-5 frames
  const noiseSpikes: { start: number; length: number }[] = [];
  const spikeRng = makeRng(77777);
  let nextSpike = 50 + Math.floor(spikeRng() * 10);
  while (nextSpike < count) {
    const length = 3 + Math.floor(spikeRng() * 3); // 3-5 frames
    noiseSpikes.push({ start: nextSpike, length });
    nextSpike += 45 + Math.floor(spikeRng() * 15); // next spike ~50 frames later
  }

  function isNoiseFrame(frameIdx: number): boolean {
    return noiseSpikes.some(
      (spike) => frameIdx >= spike.start && frameIdx < spike.start + spike.length,
    );
  }

  for (let i = 0; i < count; i++) {
    const ts = i * DT_SEC;

    if (isNoiseFrame(i)) {
      // Noise spike: joints jump to random positions (simulates ARKit latching onto bystander)
      const noiseX = 0.2 + rng() * 0.6;
      const noiseY = 0.2 + rng() * 0.6;
      const jitter = 0.02;

      frames.push({
        timestampSec: r4(ts),
        angles: {
          leftKnee: r4(90 + rng() * 90),
          rightKnee: r4(90 + rng() * 90),
          leftElbow: r4(90 + rng() * 90),
          rightElbow: r4(90 + rng() * 90),
          leftHip: r4(90 + rng() * 90),
          rightHip: r4(90 + rng() * 90),
          leftShoulder: r4(45 + rng() * 90),
          rightShoulder: r4(45 + rng() * 90),
        },
        joints: {
          head: { x: r4(noiseX + jit(rng, jitter)), y: r4(noiseY + jit(rng, jitter)), isTracked: true, confidence: r4(0.5 + rng() * 0.3) },
          neck: { x: r4(noiseX + jit(rng, jitter)), y: r4(noiseY + 0.04 + jit(rng, jitter)), isTracked: true, confidence: r4(0.5 + rng() * 0.3) },
          left_shoulder: { x: r4(noiseX - 0.1 + jit(rng, jitter * 2)), y: r4(noiseY + 0.08 + jit(rng, jitter)), isTracked: true, confidence: r4(0.4 + rng() * 0.3) },
          right_shoulder: { x: r4(noiseX + 0.1 + jit(rng, jitter * 2)), y: r4(noiseY + 0.08 + jit(rng, jitter)), isTracked: true, confidence: r4(0.4 + rng() * 0.3) },
          left_hand: { x: r4(noiseX - 0.15 + jit(rng, jitter * 2)), y: r4(noiseY + 0.2 + jit(rng, jitter)), isTracked: true, confidence: r4(0.4 + rng() * 0.3) },
          right_hand: { x: r4(noiseX + 0.15 + jit(rng, jitter * 2)), y: r4(noiseY + 0.2 + jit(rng, jitter)), isTracked: true, confidence: r4(0.4 + rng() * 0.3) },
          left_hip: { x: r4(noiseX - 0.08 + jit(rng, jitter * 2)), y: r4(noiseY + 0.25 + jit(rng, jitter)), isTracked: true, confidence: r4(0.4 + rng() * 0.3) },
          right_hip: { x: r4(noiseX + 0.08 + jit(rng, jitter * 2)), y: r4(noiseY + 0.25 + jit(rng, jitter)), isTracked: true, confidence: r4(0.4 + rng() * 0.3) },
          left_knee: { x: r4(noiseX - 0.07 + jit(rng, jitter * 2)), y: r4(noiseY + 0.38 + jit(rng, jitter)), isTracked: true, confidence: r4(0.35 + rng() * 0.3) },
          right_knee: { x: r4(noiseX + 0.07 + jit(rng, jitter * 2)), y: r4(noiseY + 0.38 + jit(rng, jitter)), isTracked: true, confidence: r4(0.35 + rng() * 0.3) },
        },
        expected: { repCount: 2 },
      });
    } else {
      // Normal rep frame
      const rep = repSignal(ts, repWindows);
      const frame = normalRepFrame(ts, rep, rng);
      frame.expected = { repCount: 2 };
      frames.push(frame);
    }
  }

  return {
    name: 'crowd-noise',
    frames,
    category: 'tracking-quality',
    description: 'Normal 2-rep sequence with random noise spikes every ~50 frames (3-5 frames each) where joints jump to random positions simulating ARKit briefly latching onto a bystander. Noise periods should be filtered out; 2 reps expected.',
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function buildStressFixtureCorpus(): StressFixtureTrace[] {
  const seeds = [42001, 42017, 42031, 42053, 42071, 42083, 42099, 42113, 42127];

  return [
    buildSkeletonOnObject(makeRng(seeds[0])),
    buildSkeletonOnObjectCrucifix(makeRng(seeds[1])),
    buildPersonWalkthroughBrief(makeRng(seeds[2])),
    buildPersonWalkthroughSteals(makeRng(seeds[3])),
    buildSubjectSwitchAndReturn(makeRng(seeds[4])),
    buildExtremeObliqueSide(makeRng(seeds[5])),
    buildPartialBodyUpperOnly(makeRng(seeds[6])),
    buildTrackingFlicker(makeRng(seeds[7])),
    buildCrowdNoise(makeRng(seeds[8])),
  ];
}
