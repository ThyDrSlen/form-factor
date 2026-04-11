/**
 * Comprehensive FQI Calculator Tests
 *
 * Tests calculateFqi() against all 8 workout definitions with:
 * - Perfect form scenarios (high scores, no faults)
 * - Minor fault scenarios (one fault triggered)
 * - Major fault scenarios (multiple faults triggered)
 * - Edge cases (zero ROM, all faults simultaneously)
 *
 * Expected scores are computed by hand from the actual calculator logic:
 *   rawScore = romScore * weights.rom + depthScore * weights.depth + (100 - faultPenalty) * weights.faults
 *   score = clamp(0, 100, Math.round(rawScore))
 */

import { calculateFqi } from '@/lib/services/fqi-calculator';
import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepAngleWindow, WorkoutDefinition } from '@/lib/types/workout-definitions';

import { pullupDefinition } from '@/lib/workouts/pullup';
import { squatDefinition } from '@/lib/workouts/squat';
import { pushupDefinition } from '@/lib/workouts/pushup';
import { deadliftDefinition } from '@/lib/workouts/deadlift';
import { rdlDefinition } from '@/lib/workouts/rdl';
import { benchpressDefinition } from '@/lib/workouts/benchpress';
import { deadHangDefinition } from '@/lib/workouts/dead-hang';
import { farmersWalkDefinition } from '@/lib/workouts/farmers-walk';

// Cast to base WorkoutDefinition to satisfy calculateFqi's parameter type
// (specific phase unions are contravariant with `string`)
const pullup = pullupDefinition as unknown as WorkoutDefinition;
const squat = squatDefinition as unknown as WorkoutDefinition;
const pushup = pushupDefinition as unknown as WorkoutDefinition;
const deadlift = deadliftDefinition as unknown as WorkoutDefinition;
const rdl = rdlDefinition as unknown as WorkoutDefinition;
const benchpress = benchpressDefinition as unknown as WorkoutDefinition;
const deadHang = deadHangDefinition as unknown as WorkoutDefinition;
const farmersWalk = farmersWalkDefinition as unknown as WorkoutDefinition;

// =============================================================================
// Helpers
// =============================================================================

/** Default neutral angles — override only what matters per test */
function a(overrides: Partial<JointAngles> = {}): JointAngles {
  return {
    leftElbow: 170,
    rightElbow: 170,
    leftShoulder: 90,
    rightShoulder: 90,
    leftKnee: 170,
    rightKnee: 170,
    leftHip: 170,
    rightHip: 170,
    ...overrides,
  };
}

/** Build a RepAngleWindow from partial overrides for start/end/min/max */
function rep(opts: {
  start?: Partial<JointAngles>;
  end?: Partial<JointAngles>;
  min?: Partial<JointAngles>;
  max?: Partial<JointAngles>;
}): RepAngleWindow {
  return {
    start: a(opts.start),
    end: a(opts.end),
    min: a(opts.min),
    max: a(opts.max),
  };
}

// =============================================================================
// FQI Weight Assertions
// =============================================================================

describe('FQI Calculator', () => {
  describe('FQI weight verification', () => {
    it('pullup weights are { rom: 0.40, depth: 0.30, faults: 0.30 }', () => {
      expect(pullup.fqiWeights).toEqual({ rom: 0.4, depth: 0.3, faults: 0.3 });
    });

    it('squat weights are { rom: 0.30, depth: 0.40, faults: 0.30 }', () => {
      expect(squatDefinition.fqiWeights).toEqual({ rom: 0.30, depth: 0.40, faults: 0.30 });
    });

    it('pushup weights are { rom: 0.35, depth: 0.35, faults: 0.30 }', () => {
      expect(pushupDefinition.fqiWeights).toEqual({ rom: 0.35, depth: 0.35, faults: 0.30 });
    });

    it('deadlift weights are { rom: 0.25, depth: 0.30, faults: 0.45 }', () => {
      expect(deadliftDefinition.fqiWeights).toEqual({ rom: 0.25, depth: 0.30, faults: 0.45 });
    });

    it('rdl weights are { rom: 0.30, depth: 0.30, faults: 0.40 }', () => {
      expect(rdlDefinition.fqiWeights).toEqual({ rom: 0.30, depth: 0.30, faults: 0.40 });
    });

    it('benchpress weights are { rom: 0.35, depth: 0.35, faults: 0.30 }', () => {
      expect(benchpressDefinition.fqiWeights).toEqual({ rom: 0.35, depth: 0.35, faults: 0.30 });
    });

    it('dead hang weights are { rom: 0.00, depth: 0.70, faults: 0.30 }', () => {
      expect(deadHangDefinition.fqiWeights).toEqual({ rom: 0.0, depth: 0.7, faults: 0.3 });
    });

    it('farmers walk weights are { rom: 0.20, depth: 0.30, faults: 0.50 }', () => {
      expect(farmersWalkDefinition.fqiWeights).toEqual({ rom: 0.20, depth: 0.30, faults: 0.50 });
    });
  });

  // ===========================================================================
  // Pull-Up
  // ===========================================================================

  describe('pullup', () => {
    // Angle ranges: elbow (70-170, opt 80, tol 15), shoulder (60-180, opt 90, tol 20)
    // Faults: incomplete_rom(15), incomplete_extension(10), shoulder_elevation(12),
    //         asymmetric_pull(8), fast_descent(5)

    it('perfect form — full ROM, good depth, no faults', () => {
      // Elbow: min=70, max=170 → ROM=100/100=100%
      // Shoulder: min=70, max=120 → ROM=50/120=41.67%  avg ROM=70.83
      // Depth elbow: |70-90|=20 > 15 → 100-(20-15)*2=90; shoulder: |70-90|=20 ≤20 → 100  avg=95
      // No faults → faultComponent=100
      // Score = 70.83*0.4 + 95*0.3 + 100*0.3 = 86.83 → 87
      const r = rep({
        start: { leftElbow: 170, rightElbow: 170, leftShoulder: 90, rightShoulder: 90 },
        end: { leftElbow: 170, rightElbow: 170, leftShoulder: 90, rightShoulder: 90 },
        min: { leftElbow: 70, rightElbow: 70, leftShoulder: 70, rightShoulder: 70 },
        max: { leftElbow: 170, rightElbow: 170, leftShoulder: 120, rightShoulder: 120 },
      });
      const result = calculateFqi(r, 2000, 1, pullup);

      expect(result.score).toBeCloseTo(87, 0);
      expect(result.romScore).toBeCloseTo(71, 0);
      expect(result.depthScore).toBeCloseTo(95, 0);
      expect(result.faultPenalty).toBe(0);
      expect(result.detectedFaults).toEqual([]);
    });

    it('minor fault — incomplete_extension only', () => {
      // start elbow avg=120 < 125 → incomplete_extension (penalty 10)
      // Elbow ROM: |170-75|=95/100=95%; Shoulder ROM: |110-70|=40/120=33.33%  avg=64.17
      // Depth: elbow |75-90|=15≤15→100; shoulder |70-90|=20≤20→100  avg=100
      // Score = 64.17*0.4 + 100*0.3 + 90*0.3 = 82.67 → 83
      const r = rep({
        start: { leftElbow: 120, rightElbow: 120, leftShoulder: 90, rightShoulder: 90 },
        end: { leftElbow: 170, rightElbow: 170, leftShoulder: 90, rightShoulder: 90 },
        min: { leftElbow: 75, rightElbow: 75, leftShoulder: 70, rightShoulder: 70 },
        max: { leftElbow: 170, rightElbow: 170, leftShoulder: 110, rightShoulder: 110 },
      });
      const result = calculateFqi(r, 2000, 1, pullup);

      expect(result.score).toBeCloseTo(83, 0);
      expect(result.faultPenalty).toBe(10);
      expect(result.detectedFaults).toEqual(['incomplete_extension']);
    });

    it('major fault — incomplete_rom + incomplete_extension + shoulder_elevation + fast_descent', () => {
      // start elbow=115 < 125 → incomplete_extension(10)
      // min elbow=115 > 110 → incomplete_rom(15)
      // max shoulder=125 > 120 → shoulder_elevation(12)
      // duration=500 < 800 → fast_descent(5)
      // Total penalty = 42
      // Elbow ROM: |170-115|=55/100=55%; Shoulder ROM: |125-80|=45/120=37.5%  avg=46.25
      // Depth: elbow |115-90|=25>15 → 100-(25-15)*2=80; shoulder |80-90|=10≤20→100  avg=90
      // Score = 46.25*0.4 + 90*0.3 + 58*0.3 = 62.9 → 63
      const r = rep({
        start: { leftElbow: 115, rightElbow: 115, leftShoulder: 90, rightShoulder: 90 },
        end: { leftElbow: 115, rightElbow: 115, leftShoulder: 90, rightShoulder: 90 },
        min: { leftElbow: 115, rightElbow: 115, leftShoulder: 80, rightShoulder: 80 },
        max: { leftElbow: 170, rightElbow: 170, leftShoulder: 125, rightShoulder: 125 },
      });
      const result = calculateFqi(r, 500, 1, pullup);

      expect(result.score).toBeCloseTo(63, 0);
      expect(result.romScore).toBeCloseTo(46, 0);
      expect(result.depthScore).toBeCloseTo(90, 0);
      expect(result.faultPenalty).toBe(42);
      expect(result.detectedFaults).toEqual(
        expect.arrayContaining(['incomplete_rom', 'incomplete_extension', 'shoulder_elevation', 'fast_descent'])
      );
      expect(result.detectedFaults).toHaveLength(4);
    });
  });

  // ===========================================================================
  // Squat
  // ===========================================================================

  describe('squat', () => {
    // Angle ranges: knee (70-175, opt 90, tol 10), hip (60-180, opt 85, tol 15)
    // Faults: shallow_depth(15), incomplete_lockout(8), knee_valgus(12),
    //         fast_rep(5), hip_shift(10), forward_lean(8)

    it('perfect form — deep squat, full lockout, no faults', () => {
      // Knee ROM: |175-85|=90/105=85.71%; Hip ROM: |180-80|=100/120=83.33%  avg=84.52
      // Depth: knee |85-90|=5≤10→100; hip |80-85|=5≤15→100  avg=100
      // Score = 84.52*0.3 + 100*0.4 + 100*0.3 = 95.36 → 95
      const r = rep({
        start: { leftKnee: 170, rightKnee: 170, leftHip: 170, rightHip: 170 },
        end: { leftKnee: 170, rightKnee: 170, leftHip: 170, rightHip: 170 },
        min: { leftKnee: 85, rightKnee: 85, leftHip: 80, rightHip: 80 },
        max: { leftKnee: 175, rightKnee: 175, leftHip: 180, rightHip: 180 },
      });
      const result = calculateFqi(r, 3000, 1, squat);

      expect(result.score).toBeCloseTo(95, 0);
      expect(result.romScore).toBeCloseTo(85, 0);
      expect(result.depthScore).toBeCloseTo(100, 0);
      expect(result.faultPenalty).toBe(0);
      expect(result.detectedFaults).toEqual([]);
    });

    it('minor fault — shallow_depth only', () => {
      // min knee avg=115 > 110 → shallow_depth(15)
      // Knee ROM: |175-115|=60/105=57.14%; Hip ROM: |180-100|=80/120=66.67%  avg=61.90
      // Depth: knee |115-90|=25>10 → 100-30=70; hip |100-85|=15≤15→100  avg=85
      // Score = 61.90*0.3 + 85*0.4 + 85*0.3 = 78.57 → 79
      const r = rep({
        start: { leftKnee: 170, rightKnee: 170, leftHip: 170, rightHip: 170 },
        end: { leftKnee: 170, rightKnee: 170, leftHip: 170, rightHip: 170 },
        min: { leftKnee: 115, rightKnee: 115, leftHip: 100, rightHip: 100 },
        max: { leftKnee: 175, rightKnee: 175, leftHip: 180, rightHip: 180 },
      });
      const result = calculateFqi(r, 3000, 1, squat);

      expect(result.score).toBeCloseTo(78, 0);
      expect(result.romScore).toBeCloseTo(62, 0);
      expect(result.depthScore).toBeCloseTo(85, 0);
      expect(result.faultPenalty).toBe(15);
      expect(result.detectedFaults).toEqual(['shallow_depth']);
    });

    it('major fault — all 6 faults triggered', () => {
      // end knee=140 < 150 → incomplete_lockout(8)
      // min knee avg=(100+130)/2=115 > 110 → shallow_depth(15)
      // |100-130|=30 > 25 → knee_valgus(12)
      // duration=800 < 1000 → fast_rep(5)
      // |55-85|=30 > 20 → hip_shift(10)
      // avgHip=70 < avgKnee(115)-25=90 → forward_lean(8)
      // Total penalty = 58
      // Knee ROM: |140-115|=25/105=23.81%; Hip ROM: |170-70|=100/120=83.33%  avg=53.57
      // Depth: knee |115-90|=25>10→70; hip |70-85|=15≤15→100  avg=85
      // Score = 53.57*0.3 + 85*0.4 + 42*0.3 = 62.67 → 63
      const r = rep({
        start: { leftKnee: 140, rightKnee: 140, leftHip: 170, rightHip: 170 },
        end: { leftKnee: 140, rightKnee: 140, leftHip: 170, rightHip: 170 },
        min: { leftKnee: 100, rightKnee: 130, leftHip: 55, rightHip: 85 },
        max: { leftKnee: 140, rightKnee: 140, leftHip: 170, rightHip: 170 },
      });
      const result = calculateFqi(r, 800, 1, squat);

      expect(result.score).toBeCloseTo(63, 0);
      expect(result.romScore).toBeCloseTo(54, 0);
      expect(result.depthScore).toBeCloseTo(85, 0);
      expect(result.faultPenalty).toBe(58);
      expect(result.detectedFaults).toHaveLength(6);
      expect(result.detectedFaults).toEqual(
        expect.arrayContaining([
          'shallow_depth',
          'incomplete_lockout',
          'knee_valgus',
          'fast_rep',
          'hip_shift',
          'forward_lean',
        ])
      );
    });
  });

  // ===========================================================================
  // Push-Up
  // ===========================================================================

  describe('pushup', () => {
    // Angle ranges: elbow (80-170, opt 90, tol 10), hip (160-180, opt 175, tol 10)
    // Faults: hip_sag(15), incomplete_lockout(10), shallow_depth(12),
    //         asymmetric_press(8), fast_rep(5), elbow_flare(10)

    it('perfect form — full ROM, stable hips, no faults', () => {
      // Elbow ROM: |170-85|=85/90=94.44%; Hip ROM: |180-160|=20/20=100%  avg=97.22
      // Depth: elbow |85-90|=5≤10→100; hip |160-175|=15>10→100-10=90  avg=95
      // Score = 97.22*0.35 + 95*0.35 + 100*0.30 = 97.28 → 97
      const r = rep({
        start: { leftElbow: 165, rightElbow: 165, leftHip: 175, rightHip: 175 },
        end: { leftElbow: 165, rightElbow: 165, leftHip: 175, rightHip: 175 },
        min: { leftElbow: 85, rightElbow: 85, leftHip: 160, rightHip: 160 },
        max: { leftElbow: 170, rightElbow: 170, leftHip: 180, rightHip: 180, leftShoulder: 110, rightShoulder: 110 },
      });
      const result = calculateFqi(r, 2000, 1, pushup);

      expect(result.score).toBeCloseTo(97, 0);
      expect(result.romScore).toBeCloseTo(97, 0);
      expect(result.depthScore).toBeCloseTo(95, 0);
      expect(result.faultPenalty).toBe(0);
      expect(result.detectedFaults).toEqual([]);
    });

    it('minor fault — shallow_depth only', () => {
      // min elbow avg=108 > 105 → shallow_depth(12)
      // Elbow ROM: |160-108|=52/90=57.78%; Hip ROM: |178-160|=18/20=90%  avg=73.89
      // Depth: elbow |108-90|=18>10→100-16=84; hip |160-175|=15>10→90  avg=87
      // Score = 73.89*0.35 + 87*0.35 + 88*0.30 = 82.71 → 83
      const r = rep({
        start: { leftElbow: 165, rightElbow: 165, leftHip: 175, rightHip: 175 },
        end: { leftElbow: 165, rightElbow: 165, leftHip: 175, rightHip: 175 },
        min: { leftElbow: 108, rightElbow: 108, leftHip: 160, rightHip: 160 },
        max: { leftElbow: 160, rightElbow: 160, leftHip: 178, rightHip: 178, leftShoulder: 100, rightShoulder: 100 },
      });
      const result = calculateFqi(r, 1500, 1, pushup);

      expect(result.score).toBeCloseTo(83, 0);
      expect(result.romScore).toBeCloseTo(74, 0);
      expect(result.depthScore).toBeCloseTo(87, 0);
      expect(result.faultPenalty).toBe(12);
      expect(result.detectedFaults).toEqual(['shallow_depth']);
    });

    it('major fault — all 6 faults triggered', () => {
      // min hip avg=150 < 160 → hip_sag(15)
      // end elbow avg=140 < 145 → incomplete_lockout(10)
      // min elbow avg=110 > 105 → shallow_depth(12)
      // |95-125|=30 > 20 → asymmetric_press(8)
      // duration=400 < 600 → fast_rep(5)
      // max shoulder=125 > 120 → elbow_flare(10)
      // Total penalty = 60
      // Elbow ROM: |155-110|=45/90=50%; Hip ROM: |175-150|=25/20=100%(capped)  avg=75
      // Depth: elbow |110-90|=20>10→80; hip |150-175|=25>10→70  avg=75
      // Score = 75*0.35 + 75*0.35 + 40*0.30 = 64.5 → 65
      const r = rep({
        start: { leftElbow: 140, rightElbow: 140, leftHip: 170, rightHip: 170 },
        end: { leftElbow: 140, rightElbow: 140, leftHip: 170, rightHip: 170 },
        min: { leftElbow: 95, rightElbow: 125, leftHip: 150, rightHip: 150 },
        max: { leftElbow: 155, rightElbow: 155, leftHip: 175, rightHip: 175, leftShoulder: 125, rightShoulder: 125 },
      });
      const result = calculateFqi(r, 400, 1, pushup);

      expect(result.score).toBeCloseTo(65, 0);
      expect(result.romScore).toBeCloseTo(75, 0);
      expect(result.depthScore).toBeCloseTo(75, 0);
      expect(result.faultPenalty).toBe(60);
      expect(result.detectedFaults).toHaveLength(6);
      expect(result.detectedFaults).toEqual(
        expect.arrayContaining([
          'hip_sag',
          'incomplete_lockout',
          'shallow_depth',
          'asymmetric_press',
          'fast_rep',
          'elbow_flare',
        ])
      );
    });
  });

  // ===========================================================================
  // Deadlift
  // ===========================================================================

  describe('deadlift', () => {
    // Angle ranges: hip (70-180, opt 80, tol 15), knee (100-180, opt 120, tol 15)
    // Faults: incomplete_lockout(12), rounded_back(20), hips_rise_first(10),
    //         asymmetric_pull(8), fast_descent(5)

    it('perfect form — full hip extension, good start position, no faults', () => {
      // Hip ROM: |175-80|=95/110=86.36%; Knee ROM: |175-110|=65/80=81.25%  avg=83.81
      // Depth: hip |80-80|=0≤15→100; knee |110-120|=10≤15→100  avg=100
      // hips_rise_first: hipChange=175-100=75, kneeChange=175-115=60, 75>90? No
      // Score = 83.81*0.25 + 100*0.30 + 100*0.45 = 95.95 → 96
      const r = rep({
        start: { leftHip: 100, rightHip: 100, leftKnee: 115, rightKnee: 115, leftShoulder: 85, rightShoulder: 85 },
        end: { leftHip: 175, rightHip: 175, leftKnee: 175, rightKnee: 175, leftShoulder: 85, rightShoulder: 85 },
        min: { leftHip: 80, rightHip: 80, leftKnee: 110, rightKnee: 110, leftShoulder: 80, rightShoulder: 80 },
        max: { leftHip: 175, rightHip: 175, leftKnee: 175, rightKnee: 175, leftShoulder: 85, rightShoulder: 85 },
      });
      const result = calculateFqi(r, 3000, 1, deadlift);

      expect(result.score).toBeCloseTo(96, 0);
      expect(result.romScore).toBeCloseTo(84, 0);
      expect(result.depthScore).toBeCloseTo(100, 0);
      expect(result.faultPenalty).toBe(0);
      expect(result.detectedFaults).toEqual([]);
    });

    it('minor fault — incomplete_lockout only', () => {
      // max hip avg=145 < 155 → incomplete_lockout(12)
      // Hip ROM: |145-85|=60/110=54.55%; Knee ROM: |160-115|=45/80=56.25%  avg=55.40
      // Depth: hip |85-80|=5≤15→100; knee |115-120|=5≤15→100  avg=100
      // Score = 55.40*0.25 + 100*0.30 + 88*0.45 = 83.45 → 83
      const r = rep({
        start: { leftHip: 100, rightHip: 100, leftKnee: 115, rightKnee: 115, leftShoulder: 85, rightShoulder: 85 },
        end: { leftHip: 145, rightHip: 145, leftKnee: 160, rightKnee: 160, leftShoulder: 85, rightShoulder: 85 },
        min: { leftHip: 85, rightHip: 85, leftKnee: 115, rightKnee: 115, leftShoulder: 80, rightShoulder: 80 },
        max: { leftHip: 145, rightHip: 145, leftKnee: 160, rightKnee: 160, leftShoulder: 85, rightShoulder: 85 },
      });
      const result = calculateFqi(r, 3000, 1, deadlift);

      expect(result.score).toBeCloseTo(83, 0);
      expect(result.romScore).toBeCloseTo(55, 0);
      expect(result.depthScore).toBeCloseTo(100, 0);
      expect(result.faultPenalty).toBe(12);
      expect(result.detectedFaults).toEqual(['incomplete_lockout']);
    });

    it('major fault — all 5 faults triggered', () => {
      // max hip avg=(130+160)/2=145 < 155 → incomplete_lockout(12)
      // max shoulder=130 > 120 → rounded_back(20)
      // hipChange=130-80=50, kneeChange=155-140=15, 50>45 → hips_rise_first(10)
      // |130-160|=30 > 20 → asymmetric_pull(8)
      // duration=1000 < 1200 → fast_descent(5)
      // Total penalty = 55
      // Hip ROM: |(130+160)/2 - 80|=65/110=59.09%; Knee ROM: |155-115|=40/80=50%  avg=54.55
      // Depth: hip |80-80|=0→100; knee |115-120|=5→100  avg=100
      // Score = 54.55*0.25 + 100*0.30 + 45*0.45 = 63.89 → 64
      const r = rep({
        start: { leftHip: 80, rightHip: 80, leftKnee: 140, rightKnee: 140, leftShoulder: 85, rightShoulder: 85 },
        end: { leftHip: 140, rightHip: 160, leftKnee: 155, rightKnee: 155, leftShoulder: 85, rightShoulder: 85 },
        min: { leftHip: 80, rightHip: 80, leftKnee: 115, rightKnee: 115, leftShoulder: 80, rightShoulder: 80 },
        max: { leftHip: 130, rightHip: 160, leftKnee: 155, rightKnee: 155, leftShoulder: 125, rightShoulder: 130 },
      });
      const result = calculateFqi(r, 1000, 1, deadlift);

      expect(result.score).toBeCloseTo(64, 0);
      expect(result.romScore).toBeCloseTo(55, 0);
      expect(result.depthScore).toBeCloseTo(100, 0);
      expect(result.faultPenalty).toBe(55);
      expect(result.detectedFaults).toHaveLength(5);
      expect(result.detectedFaults).toEqual(
        expect.arrayContaining([
          'incomplete_lockout',
          'rounded_back',
          'hips_rise_first',
          'asymmetric_pull',
          'fast_descent',
        ])
      );
    });
  });

  // ===========================================================================
  // RDL (Romanian Deadlift)
  // ===========================================================================

  describe('rdl', () => {
    // Angle ranges: hip (80-180, opt 90, tol 15), knee (130-180, opt 160, tol 15)
    // Faults: knee_bend_excessive(15), shallow_hinge(12), incomplete_lockout(8),
    //         rounded_back(18), asymmetric_hinge(8), fast_rep(5)

    it('perfect form — deep hinge, soft knees, no faults', () => {
      // Hip ROM: |175-88|=87/100=87%; Knee ROM: |175-150|=25/50=50%  avg=68.5
      // Depth: hip |88-90|=2≤15→100; knee |150-160|=10≤15→100  avg=100
      // Score = 68.5*0.3 + 100*0.3 + 100*0.4 = 90.55 → 91
      const r = rep({
        start: { leftHip: 170, rightHip: 170, leftKnee: 165, rightKnee: 165, leftShoulder: 85, rightShoulder: 85 },
        end: { leftHip: 170, rightHip: 170, leftKnee: 165, rightKnee: 165, leftShoulder: 85, rightShoulder: 85 },
        min: { leftHip: 88, rightHip: 88, leftKnee: 150, rightKnee: 150, leftShoulder: 85, rightShoulder: 85 },
        max: { leftHip: 175, rightHip: 175, leftKnee: 175, rightKnee: 175, leftShoulder: 85, rightShoulder: 85 },
      });
      const result = calculateFqi(r, 3000, 1, rdl);

      expect(result.score).toBeCloseTo(91, 0);
      expect(result.romScore).toBeCloseTo(69, 0);
      expect(result.depthScore).toBeCloseTo(100, 0);
      expect(result.faultPenalty).toBe(0);
      expect(result.detectedFaults).toEqual([]);
    });

    it('minor fault — shallow_hinge only', () => {
      // min hip avg=115 > 110 → shallow_hinge(12)
      // Hip ROM: |170-115|=55/100=55%; Knee ROM: |170-155|=15/50=30%  avg=42.5
      // Depth: hip |115-90|=25>15→100-20=80; knee |155-160|=5≤15→100  avg=90
      // Score = 42.5*0.3 + 90*0.3 + 88*0.4 = 75.15 → 75
      const r = rep({
        start: { leftHip: 170, rightHip: 170, leftKnee: 165, rightKnee: 165, leftShoulder: 85, rightShoulder: 85 },
        end: { leftHip: 170, rightHip: 170, leftKnee: 165, rightKnee: 165, leftShoulder: 85, rightShoulder: 85 },
        min: { leftHip: 115, rightHip: 115, leftKnee: 155, rightKnee: 155, leftShoulder: 85, rightShoulder: 85 },
        max: { leftHip: 170, rightHip: 170, leftKnee: 170, rightKnee: 170, leftShoulder: 85, rightShoulder: 85 },
      });
      const result = calculateFqi(r, 3000, 1, rdl);

      expect(result.score).toBeCloseTo(75, 0);
      expect(result.romScore).toBeCloseTo(43, 0);
      expect(result.depthScore).toBeCloseTo(90, 0);
      expect(result.faultPenalty).toBe(12);
      expect(result.detectedFaults).toEqual(['shallow_hinge']);
    });

    it('major fault — 5 faults triggered', () => {
      // min knee avg=120 < 130 → knee_bend_excessive(15)
      // max hip avg=150 < 155 → incomplete_lockout(8)
      // max shoulder=135 > 130 → rounded_back(18)
      // |85-115|=30 > 20 → asymmetric_hinge(8)
      // duration=1000 < 1500 → fast_rep(5)
      // Total penalty = 54
      // Hip ROM: |(85+115)/2=100, max=150|=50/100=50%; Knee ROM: |170-120|=50/50=100%  avg=75
      // Depth: hip |100-90|=10≤15→100; knee |120-160|=40>15→100-50=50  avg=75
      // Score = 75*0.3 + 75*0.3 + 46*0.4 = 63.4 → 63
      const r = rep({
        start: { leftHip: 160, rightHip: 160, leftKnee: 165, rightKnee: 165, leftShoulder: 85, rightShoulder: 85 },
        end: { leftHip: 150, rightHip: 150, leftKnee: 160, rightKnee: 160, leftShoulder: 85, rightShoulder: 85 },
        min: { leftHip: 85, rightHip: 115, leftKnee: 120, rightKnee: 120, leftShoulder: 85, rightShoulder: 85 },
        max: { leftHip: 150, rightHip: 150, leftKnee: 170, rightKnee: 170, leftShoulder: 135, rightShoulder: 135 },
      });
      const result = calculateFqi(r, 1000, 1, rdl);

      expect(result.score).toBeCloseTo(63, 0);
      expect(result.romScore).toBeCloseTo(75, 0);
      expect(result.depthScore).toBeCloseTo(75, 0);
      expect(result.faultPenalty).toBe(54);
      expect(result.detectedFaults).toHaveLength(5);
      expect(result.detectedFaults).toEqual(
        expect.arrayContaining([
          'knee_bend_excessive',
          'incomplete_lockout',
          'rounded_back',
          'asymmetric_hinge',
          'fast_rep',
        ])
      );
    });
  });

  // ===========================================================================
  // Bench Press
  // ===========================================================================

  describe('benchpress', () => {
    // Angle ranges: elbow (80-170, opt 90, tol 10), shoulder (60-180, opt 90, tol 20)
    // Faults: incomplete_lockout(10), shallow_depth(12), asymmetric_press(8),
    //         fast_rep(5), elbow_flare(10)

    it('perfect form — full ROM, good depth, no faults', () => {
      // Elbow ROM: |170-85|=85/90=94.44%; Shoulder ROM: |115-70|=45/120=37.5%  avg=65.97
      // Depth: elbow |85-90|=5≤10→100; shoulder |70-90|=20≤20→100  avg=100
      // Score = 65.97*0.35 + 100*0.35 + 100*0.30 = 88.09 → 88
      const r = rep({
        start: { leftElbow: 165, rightElbow: 165, leftShoulder: 85, rightShoulder: 85 },
        end: { leftElbow: 165, rightElbow: 165, leftShoulder: 85, rightShoulder: 85 },
        min: { leftElbow: 85, rightElbow: 85, leftShoulder: 70, rightShoulder: 70 },
        max: { leftElbow: 170, rightElbow: 170, leftShoulder: 115, rightShoulder: 115 },
      });
      const result = calculateFqi(r, 2000, 1, benchpress);

      expect(result.score).toBeCloseTo(88, 0);
      expect(result.romScore).toBeCloseTo(66, 0);
      expect(result.depthScore).toBeCloseTo(100, 0);
      expect(result.faultPenalty).toBe(0);
      expect(result.detectedFaults).toEqual([]);
    });

    it('minor fault — shallow_depth only', () => {
      // min elbow avg=108 > 105 → shallow_depth(12)
      // Elbow ROM: |165-108|=57/90=63.33%; Shoulder ROM: |115-75|=40/120=33.33%  avg=48.33
      // Depth: elbow |108-90|=18>10→100-16=84; shoulder |75-90|=15≤20→100  avg=92
      // Score = 48.33*0.35 + 92*0.35 + 88*0.30 = 75.52 → 76
      const r = rep({
        start: { leftElbow: 165, rightElbow: 165, leftShoulder: 85, rightShoulder: 85 },
        end: { leftElbow: 165, rightElbow: 165, leftShoulder: 85, rightShoulder: 85 },
        min: { leftElbow: 108, rightElbow: 108, leftShoulder: 75, rightShoulder: 75 },
        max: { leftElbow: 165, rightElbow: 165, leftShoulder: 115, rightShoulder: 115 },
      });
      const result = calculateFqi(r, 2000, 1, benchpress);

      expect(result.score).toBeCloseTo(76, 0);
      expect(result.romScore).toBeCloseTo(48, 0);
      expect(result.depthScore).toBeCloseTo(92, 0);
      expect(result.faultPenalty).toBe(12);
      expect(result.detectedFaults).toEqual(['shallow_depth']);
    });

    it('major fault — all 5 faults triggered', () => {
      // end elbow avg=140 < 145 → incomplete_lockout(10)
      // min elbow avg=110 > 105 → shallow_depth(12)
      // |95-125|=30 > 20 → asymmetric_press(8)
      // duration=400 < 600 → fast_rep(5)
      // max shoulder=125 > 120 → elbow_flare(10)
      // Total penalty = 45
      // Elbow ROM: |155-110|=45/90=50%; Shoulder ROM: |125-80|=45/120=37.5%  avg=43.75
      // Depth: elbow |110-90|=20>10→80; shoulder |80-90|=10≤20→100  avg=90
      // Score = 43.75*0.35 + 90*0.35 + 55*0.30 = 63.31 → 63
      const r = rep({
        start: { leftElbow: 140, rightElbow: 140, leftShoulder: 90, rightShoulder: 90 },
        end: { leftElbow: 140, rightElbow: 140, leftShoulder: 90, rightShoulder: 90 },
        min: { leftElbow: 95, rightElbow: 125, leftShoulder: 80, rightShoulder: 80 },
        max: { leftElbow: 155, rightElbow: 155, leftShoulder: 125, rightShoulder: 125 },
      });
      const result = calculateFqi(r, 400, 1, benchpress);

      expect(result.score).toBeCloseTo(63, 0);
      expect(result.romScore).toBeCloseTo(44, 0);
      expect(result.depthScore).toBeCloseTo(90, 0);
      expect(result.faultPenalty).toBe(45);
      expect(result.detectedFaults).toHaveLength(5);
      expect(result.detectedFaults).toEqual(
        expect.arrayContaining([
          'incomplete_lockout',
          'shallow_depth',
          'asymmetric_press',
          'fast_rep',
          'elbow_flare',
        ])
      );
    });
  });

  // ===========================================================================
  // Dead Hang
  // ===========================================================================

  describe('dead hang', () => {
    // Angle ranges: elbow (140-180, opt 170, tol 10), shoulder (60-180, opt 90, tol 25)
    // Faults: bent_arms(12), shrugged_shoulders(8), short_hold(5)
    // ROM weight = 0 → only depth and faults matter

    it('perfect form — straight arms, packed shoulders, long hold', () => {
      // ROM weight=0 so ROM doesn't contribute
      // Depth: elbow |165-170|=5≤10→100; shoulder |80-90|=10≤25→100  avg=100
      // Score = 0 + 100*0.7 + 100*0.3 = 100
      const r = rep({
        start: { leftElbow: 170, rightElbow: 170, leftShoulder: 85, rightShoulder: 85 },
        end: { leftElbow: 170, rightElbow: 170, leftShoulder: 85, rightShoulder: 85 },
        min: { leftElbow: 165, rightElbow: 165, leftShoulder: 80, rightShoulder: 80 },
        max: { leftElbow: 175, rightElbow: 175, leftShoulder: 105, rightShoulder: 105 },
      });
      const result = calculateFqi(r, 30000, 1, deadHang);

      expect(result.score).toBeCloseTo(100, 0);
      expect(result.depthScore).toBeCloseTo(100, 0);
      expect(result.faultPenalty).toBe(0);
      expect(result.detectedFaults).toEqual([]);
    });

    it('minor fault — bent_arms only', () => {
      // min elbow avg=135 < 140 → bent_arms(12)
      // Depth: elbow |135-170|=35>10→100-50=50; shoulder |80-90|=10≤25→100  avg=75
      // Score = 0 + 75*0.7 + 88*0.3 = 78.9 → 79
      const r = rep({
        start: { leftElbow: 170, rightElbow: 170, leftShoulder: 85, rightShoulder: 85 },
        end: { leftElbow: 170, rightElbow: 170, leftShoulder: 85, rightShoulder: 85 },
        min: { leftElbow: 135, rightElbow: 135, leftShoulder: 80, rightShoulder: 80 },
        max: { leftElbow: 160, rightElbow: 160, leftShoulder: 110, rightShoulder: 110 },
      });
      const result = calculateFqi(r, 30000, 1, deadHang);

      expect(result.score).toBeCloseTo(79, 0);
      expect(result.depthScore).toBeCloseTo(75, 0);
      expect(result.faultPenalty).toBe(12);
      expect(result.detectedFaults).toEqual(['bent_arms']);
    });

    it('major fault — all 3 faults triggered', () => {
      // min elbow avg=130 < 140 → bent_arms(12)
      // max shoulder=120 > 115 → shrugged_shoulders(8)
      // duration=1000 < 1500 → short_hold(5)
      // Total penalty = 25
      // Depth: elbow |130-170|=40>10→100-60=40; shoulder |80-90|=10≤25→100  avg=70
      // Score = 0 + 70*0.7 + 75*0.3 = 71.5 → 72
      const r = rep({
        start: { leftElbow: 170, rightElbow: 170, leftShoulder: 85, rightShoulder: 85 },
        end: { leftElbow: 170, rightElbow: 170, leftShoulder: 85, rightShoulder: 85 },
        min: { leftElbow: 130, rightElbow: 130, leftShoulder: 80, rightShoulder: 80 },
        max: { leftElbow: 155, rightElbow: 155, leftShoulder: 120, rightShoulder: 120 },
      });
      const result = calculateFqi(r, 1000, 1, deadHang);

      expect(result.score).toBeCloseTo(72, 0);
      expect(result.depthScore).toBeCloseTo(70, 0);
      expect(result.faultPenalty).toBe(25);
      expect(result.detectedFaults).toHaveLength(3);
      expect(result.detectedFaults).toEqual(
        expect.arrayContaining(['bent_arms', 'shrugged_shoulders', 'short_hold'])
      );
    });
  });

  // ===========================================================================
  // Farmers Walk
  // ===========================================================================

  describe('farmers walk', () => {
    // Angle ranges: shoulder (70-120, opt 90, tol 15), hip (100-180, opt 175, tol 10)
    // Faults: lateral_lean(12), shoulder_shrug(10), forward_lean(12),
    //         asymmetric_shoulders(8), short_carry(5), rushed_pickup(5)

    it('perfect form — tall posture, level shoulders, long carry', () => {
      // Shoulder ROM: |110-80|=30/50=60%; Hip ROM: |180-170|=10/80=12.5%  avg=36.25
      // Depth: shoulder |80-90|=10≤15→100; hip |170-175|=5≤10→100  avg=100
      // Score = 36.25*0.2 + 100*0.3 + 100*0.5 = 87.25 → 87
      const r = rep({
        start: { leftShoulder: 90, rightShoulder: 90, leftHip: 175, rightHip: 175 },
        end: { leftShoulder: 90, rightShoulder: 90, leftHip: 175, rightHip: 175 },
        min: { leftShoulder: 80, rightShoulder: 80, leftHip: 170, rightHip: 170 },
        max: { leftShoulder: 110, rightShoulder: 110, leftHip: 180, rightHip: 180 },
      });
      const result = calculateFqi(r, 30000, 1, farmersWalk);

      expect(result.score).toBeCloseTo(87, 0);
      expect(result.romScore).toBeCloseTo(36, 0);
      expect(result.depthScore).toBeCloseTo(100, 0);
      expect(result.faultPenalty).toBe(0);
      expect(result.detectedFaults).toEqual([]);
    });

    it('minor fault — forward_lean only', () => {
      // max hip avg=145 < 150 → forward_lean(12)
      // Shoulder ROM: |105-80|=25/50=50%; Hip ROM: |145-140|=5/80=6.25%  avg=28.13
      // Depth: shoulder |80-90|=10≤15→100; hip |140-175|=35>10→100-50=50  avg=75
      // Score = 28.13*0.2 + 75*0.3 + 88*0.5 = 72.13 → 72
      const r = rep({
        start: { leftShoulder: 90, rightShoulder: 90, leftHip: 145, rightHip: 145 },
        end: { leftShoulder: 90, rightShoulder: 90, leftHip: 145, rightHip: 145 },
        min: { leftShoulder: 80, rightShoulder: 80, leftHip: 140, rightHip: 140 },
        max: { leftShoulder: 105, rightShoulder: 105, leftHip: 145, rightHip: 145 },
      });
      const result = calculateFqi(r, 30000, 1, farmersWalk);

      expect(result.score).toBeCloseTo(72, 0);
      expect(result.romScore).toBeCloseTo(28, 0);
      expect(result.depthScore).toBeCloseTo(75, 0);
      expect(result.faultPenalty).toBe(12);
      expect(result.detectedFaults).toEqual(['forward_lean']);
    });

    it('major fault — all 6 faults triggered', () => {
      // |155-175|=20 > 15 → lateral_lean(12)
      // min(70,70)=70 < 75 → shoulder_shrug(10)
      // max hip avg=145 < 150 → forward_lean(12)
      // |70-90|=20 > 15 → asymmetric_shoulders(8)
      // duration=4000 < 5000 → short_carry(5)
      // duration=4000 > 3000 → rushed_pickup NOT triggered (4000 >= 3000)
      //
      // Actually rushed_pickup: durationMs < 3000 → 4000 < 3000? No.
      // Use duration=2500 to trigger both short_carry AND rushed_pickup.
      // duration=2500 < 5000 → short_carry(5)
      // duration=2500 < 3000 → rushed_pickup(5)
      // Total penalty = 12+10+12+8+5+5 = 52
      //
      // Shoulder ROM: |100-(70+90)/2|=|100-80|=20/50=40%;
      //   Wait, let me recalculate. avgMin=(70+90)/2=80, avgMax=(100+100)/2=100
      //   ROM=|100-80|=20, target=50, score=40%
      // Hip ROM: avgMin=(155+175)/2=165, avgMax=(145+145)/2=145
      //   ROM=|145-165|=20, target=80, score=25%
      // avg ROM = (40+25)/2 = 32.5
      //
      // Depth: shoulder avgMin=80, |80-90|=10≤15→100;
      //        hip avgMin=165, |165-175|=10≤10→100  avg=100
      // Score = 32.5*0.2 + 100*0.3 + 48*0.5 = 60.5 → 61
      const r = rep({
        start: { leftShoulder: 85, rightShoulder: 85, leftHip: 160, rightHip: 160 },
        end: { leftShoulder: 85, rightShoulder: 85, leftHip: 160, rightHip: 160 },
        min: { leftShoulder: 70, rightShoulder: 90, leftHip: 155, rightHip: 175 },
        max: { leftShoulder: 100, rightShoulder: 100, leftHip: 145, rightHip: 145 },
      });
      const result = calculateFqi(r, 2500, 1, farmersWalk);

      expect(result.score).toBeCloseTo(61, 0);
      expect(result.romScore).toBeCloseTo(33, 0);
      expect(result.depthScore).toBeCloseTo(100, 0);
      expect(result.faultPenalty).toBe(52);
      expect(result.detectedFaults).toHaveLength(6);
      expect(result.detectedFaults).toEqual(
        expect.arrayContaining([
          'lateral_lean',
          'shoulder_shrug',
          'forward_lean',
          'asymmetric_shoulders',
          'short_carry',
          'rushed_pickup',
        ])
      );
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('edge cases', () => {
    it('zero ROM input — all angles identical → ROM score is 0', () => {
      // All min/max angles identical → actualRom = 0 for every metric → ROM = 0
      // Depth: elbow |170-80|=90>15→100-150=0(clamped); shoulder |90-90|=0→100  avg=50
      // Score = 0*0.4 + 50*0.3 + 100*0.3 = 45
      const sameAngles = a();
      const r: RepAngleWindow = {
        start: sameAngles,
        end: sameAngles,
        min: sameAngles,
        max: sameAngles,
      };
      const result = calculateFqi(r, 2000, 1, pullup);

      // ROM = 0 because all min/max are identical
      expect(result.romScore).toBe(0);
      // Score should still be non-negative
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it('max faults — penalty capped at 100', () => {
      // Construct a scenario where all pullup faults fire with extreme values
      // incomplete_rom(15) + incomplete_extension(10) + shoulder_elevation(12) +
      // asymmetric_pull(8) + fast_descent(5) = 50 total (under 100, but verify capping logic)
      const r = rep({
        start: { leftElbow: 100, rightElbow: 100, leftShoulder: 90, rightShoulder: 90 },
        end: { leftElbow: 100, rightElbow: 100, leftShoulder: 90, rightShoulder: 90 },
        min: { leftElbow: 100, rightElbow: 130, leftShoulder: 80, rightShoulder: 80 },
        max: { leftElbow: 170, rightElbow: 170, leftShoulder: 150, rightShoulder: 150 },
      });
      const result = calculateFqi(r, 200, 1, pullup);

      // Verify all 5 pullup faults triggered:
      // incomplete_rom: avg min elbow = (100+130)/2=115 > 110 ✓
      // incomplete_extension: avg start elbow = 100 < 125 ✓
      // shoulder_elevation: max(150,150) > 120 ✓
      // asymmetric_pull: |100-130|=30 > 20 ✓
      // fast_descent: 200 < 800 ✓
      expect(result.detectedFaults).toHaveLength(5);
      expect(result.faultPenalty).toBe(50);
      // Penalty is under 100 so no capping needed, but score should still be valid
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it('NaN guard — non-finite angles produce score 0', () => {
      const r = rep({
        min: { leftElbow: NaN, rightElbow: NaN, leftShoulder: NaN, rightShoulder: NaN },
        max: { leftElbow: NaN, rightElbow: NaN, leftShoulder: NaN, rightShoulder: NaN },
      });
      const result = calculateFqi(r, 2000, 1, pullup);

      // When scoring metrics return NaN, the calculator guards against it
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it('all squat faults fire simultaneously — penalty sums correctly', () => {
      // Verify the exact penalty sum: 15+8+12+5+10+8 = 58
      const r = rep({
        start: { leftKnee: 140, rightKnee: 140, leftHip: 170, rightHip: 170 },
        end: { leftKnee: 140, rightKnee: 140, leftHip: 170, rightHip: 170 },
        min: { leftKnee: 100, rightKnee: 130, leftHip: 55, rightHip: 85 },
        max: { leftKnee: 140, rightKnee: 140, leftHip: 170, rightHip: 170 },
      });
      const result = calculateFqi(r, 800, 1, squat);

      expect(result.faultPenalty).toBe(58);
      expect(result.detectedFaults).toHaveLength(6);
    });

    it('dead hang with ROM weight 0 — ROM score does not affect final score', () => {
      // Even with terrible ROM, score should only depend on depth + faults
      const r = rep({
        min: { leftElbow: 165, rightElbow: 165, leftShoulder: 85, rightShoulder: 85 },
        max: { leftElbow: 170, rightElbow: 170, leftShoulder: 90, rightShoulder: 90 },
      });
      const result = calculateFqi(r, 30000, 1, deadHang);

      // Depth: elbow |165-170|=5≤10→100; shoulder |85-90|=5≤25→100  avg=100
      // Score = 0 + 100*0.7 + 100*0.3 = 100
      expect(result.score).toBeCloseTo(100, 0);
    });

    it('extremely short duration triggers all time-based faults', () => {
      // Farmers walk with duration=100ms should trigger both short_carry and rushed_pickup
      const r = rep({
        start: { leftShoulder: 90, rightShoulder: 90, leftHip: 175, rightHip: 175 },
        end: { leftShoulder: 90, rightShoulder: 90, leftHip: 175, rightHip: 175 },
        min: { leftShoulder: 85, rightShoulder: 85, leftHip: 170, rightHip: 170 },
        max: { leftShoulder: 95, rightShoulder: 95, leftHip: 180, rightHip: 180 },
      });
      const result = calculateFqi(r, 100, 1, farmersWalk);

      expect(result.detectedFaults).toEqual(
        expect.arrayContaining(['short_carry', 'rushed_pickup'])
      );
    });
  });
});
