import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';

import { pullupDefinition } from '@/lib/workouts/pullup';
import { squatDefinition } from '@/lib/workouts/squat';
import { pushupDefinition } from '@/lib/workouts/pushup';
import { deadliftDefinition } from '@/lib/workouts/deadlift';
import { rdlDefinition } from '@/lib/workouts/rdl';
import { benchpressDefinition } from '@/lib/workouts/benchpress';
import { deadHangDefinition } from '@/lib/workouts/dead-hang';
import { farmersWalkDefinition } from '@/lib/workouts/farmers-walk';

// =============================================================================
// Helpers
// =============================================================================

/** Default neutral angles — override only what matters per test */
function angles(overrides: Partial<JointAngles> = {}): JointAngles {
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

/** Build a RepContext with partial overrides */
function ctx(opts: {
  start?: Partial<JointAngles>;
  end?: Partial<JointAngles>;
  min?: Partial<JointAngles>;
  max?: Partial<JointAngles>;
  durationMs?: number;
  repNumber?: number;
  workoutId?: string;
}): RepContext {
  return {
    startAngles: angles(opts.start),
    endAngles: angles(opts.end),
    minAngles: angles(opts.min),
    maxAngles: angles(opts.max),
    durationMs: opts.durationMs ?? 5000,
    repNumber: opts.repNumber ?? 1,
    workoutId: opts.workoutId ?? 'test',
  };
}

/** Find a fault by ID or throw */
function fault(def: { faults: { id: string; condition: (ctx: RepContext) => boolean }[] }, id: string) {
  const f = def.faults.find((f) => f.id === id);
  if (!f) throw new Error(`Fault '${id}' not found in definition`);
  return f;
}

// =============================================================================
// Pullup Faults
// =============================================================================

describe('pullup faults', () => {
  // Thresholds: hang=150, engage=140, top=85, shoulderElevation=120

  describe('incomplete_rom', () => {
    const f = fault(pullupDefinition, 'incomplete_rom');

    it('triggers when min elbow avg > top + 15 (100)', () => {
      // avg min elbow = (105 + 105) / 2 = 105 > 100
      const c = ctx({ min: { leftElbow: 105, rightElbow: 105 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (min elbow avg ≤ 100)', () => {
      // avg min elbow = (80 + 80) / 2 = 80 ≤ 100
      const c = ctx({ min: { leftElbow: 80, rightElbow: 80 } });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('incomplete_extension', () => {
    const f = fault(pullupDefinition, 'incomplete_extension');

    it('triggers when start elbow avg < hang - 10 (140)', () => {
      // avg start elbow = (130 + 130) / 2 = 130 < 140
      const c = ctx({ start: { leftElbow: 130, rightElbow: 130 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (start elbow avg ≥ 140)', () => {
      // avg start elbow = (160 + 160) / 2 = 160 ≥ 140
      const c = ctx({ start: { leftElbow: 160, rightElbow: 160 } });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('shoulder_elevation', () => {
    const f = fault(pullupDefinition, 'shoulder_elevation');

    it('triggers when max shoulder > 120', () => {
      const c = ctx({ max: { leftShoulder: 125, rightShoulder: 110 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (max shoulder ≤ 120)', () => {
      const c = ctx({ max: { leftShoulder: 110, rightShoulder: 115 } });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('asymmetric_pull', () => {
    const f = fault(pullupDefinition, 'asymmetric_pull');

    it('triggers when |min left - min right elbow| > 20', () => {
      const c = ctx({ min: { leftElbow: 70, rightElbow: 95 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (elbow diff ≤ 20)', () => {
      const c = ctx({ min: { leftElbow: 80, rightElbow: 85 } });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('fast_descent', () => {
    const f = fault(pullupDefinition, 'fast_descent');

    it('triggers when durationMs < 800', () => {
      const c = ctx({ durationMs: 500 });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (durationMs ≥ 800)', () => {
      const c = ctx({ durationMs: 2000 });
      expect(f.condition(c)).toBe(false);
    });
  });
});

// =============================================================================
// Squat Faults
// =============================================================================

describe('squat faults', () => {
  // Thresholds: standing=160, parallel=95, kneeValgusMax=25

  describe('shallow_depth', () => {
    const f = fault(squatDefinition, 'shallow_depth');

    it('triggers when min knee avg > parallel + 15 (110)', () => {
      // avg = (115 + 115) / 2 = 115 > 110
      const c = ctx({ min: { leftKnee: 115, rightKnee: 115 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (min knee avg ≤ 110)', () => {
      const c = ctx({ min: { leftKnee: 90, rightKnee: 90 } });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('incomplete_lockout', () => {
    const f = fault(squatDefinition, 'incomplete_lockout');

    it('triggers when end knee avg < standing - 10 (150)', () => {
      // avg = (145 + 145) / 2 = 145 < 150
      const c = ctx({ end: { leftKnee: 145, rightKnee: 145 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (end knee avg ≥ 150)', () => {
      const c = ctx({ end: { leftKnee: 165, rightKnee: 165 } });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('knee_valgus', () => {
    const f = fault(squatDefinition, 'knee_valgus');

    it('triggers when |min left - min right knee| > 25', () => {
      const c = ctx({ min: { leftKnee: 80, rightKnee: 110 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (knee diff ≤ 25)', () => {
      const c = ctx({ min: { leftKnee: 85, rightKnee: 90 } });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('fast_rep', () => {
    const f = fault(squatDefinition, 'fast_rep');

    it('triggers when durationMs < 1000', () => {
      const c = ctx({ durationMs: 800 });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (durationMs ≥ 1000)', () => {
      const c = ctx({ durationMs: 3000 });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('hip_shift', () => {
    const f = fault(squatDefinition, 'hip_shift');

    it('triggers when |min left - min right hip| > 20', () => {
      const c = ctx({ min: { leftHip: 70, rightHip: 95 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (hip diff ≤ 20)', () => {
      const c = ctx({ min: { leftHip: 80, rightHip: 85 } });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('forward_lean', () => {
    const f = fault(squatDefinition, 'forward_lean');

    it('triggers when avg min hip < avg min knee - 25', () => {
      // avgHip = (60+60)/2 = 60, avgKnee = (95+95)/2 = 95, 60 < 95-25=70 ✓
      const c = ctx({ min: { leftHip: 60, rightHip: 60, leftKnee: 95, rightKnee: 95 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (avg hip ≥ avg knee - 25)', () => {
      // avgHip = (85+85)/2 = 85, avgKnee = (90+90)/2 = 90, 85 ≥ 90-25=65
      const c = ctx({ min: { leftHip: 85, rightHip: 85, leftKnee: 90, rightKnee: 90 } });
      expect(f.condition(c)).toBe(false);
    });
  });
});

// =============================================================================
// Pushup Faults
// =============================================================================

describe('pushup faults', () => {
  // Thresholds: readyElbow=155, bottom=90

  describe('hip_sag', () => {
    const f = fault(pushupDefinition, 'hip_sag');

    it('triggers when avg min hip < 160', () => {
      // avg = (150 + 150) / 2 = 150 < 160
      const c = ctx({ min: { leftHip: 150, rightHip: 150 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (avg min hip ≥ 160)', () => {
      const c = ctx({ min: { leftHip: 175, rightHip: 175 } });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('incomplete_lockout', () => {
    const f = fault(pushupDefinition, 'incomplete_lockout');

    it('triggers when end elbow avg < readyElbow - 10 (145)', () => {
      // avg = (140 + 140) / 2 = 140 < 145
      const c = ctx({ end: { leftElbow: 140, rightElbow: 140 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (end elbow avg ≥ 145)', () => {
      const c = ctx({ end: { leftElbow: 165, rightElbow: 165 } });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('shallow_depth', () => {
    const f = fault(pushupDefinition, 'shallow_depth');

    it('triggers when min elbow avg > bottom + 15 (105)', () => {
      // avg = (110 + 110) / 2 = 110 > 105
      const c = ctx({ min: { leftElbow: 110, rightElbow: 110 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (min elbow avg ≤ 105)', () => {
      const c = ctx({ min: { leftElbow: 88, rightElbow: 88 } });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('asymmetric_press', () => {
    const f = fault(pushupDefinition, 'asymmetric_press');

    it('triggers when |min left - min right elbow| > 20', () => {
      const c = ctx({ min: { leftElbow: 80, rightElbow: 110 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (elbow diff ≤ 20)', () => {
      const c = ctx({ min: { leftElbow: 85, rightElbow: 90 } });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('fast_rep', () => {
    const f = fault(pushupDefinition, 'fast_rep');

    it('triggers when durationMs < 600', () => {
      const c = ctx({ durationMs: 400 });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (durationMs ≥ 600)', () => {
      const c = ctx({ durationMs: 2000 });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('elbow_flare', () => {
    const f = fault(pushupDefinition, 'elbow_flare');

    it('triggers when max shoulder > 120', () => {
      const c = ctx({ max: { leftShoulder: 125, rightShoulder: 110 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (max shoulder ≤ 120)', () => {
      const c = ctx({ max: { leftShoulder: 100, rightShoulder: 115 } });
      expect(f.condition(c)).toBe(false);
    });
  });
});

// =============================================================================
// Deadlift Faults
// =============================================================================

describe('deadlift faults', () => {
  // Thresholds: lockout=165, address=120, bottom=85, shoulderNeutral=90

  describe('incomplete_lockout', () => {
    const f = fault(deadliftDefinition, 'incomplete_lockout');

    it('triggers when max hip avg < lockout - 10 (155)', () => {
      // avg = (150 + 150) / 2 = 150 < 155
      const c = ctx({ max: { leftHip: 150, rightHip: 150 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (max hip avg ≥ 155)', () => {
      const c = ctx({ max: { leftHip: 175, rightHip: 175 } });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('rounded_back', () => {
    const f = fault(deadliftDefinition, 'rounded_back');

    it('triggers when max shoulder > 120', () => {
      const c = ctx({ max: { leftShoulder: 125, rightShoulder: 110 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (max shoulder ≤ 120)', () => {
      const c = ctx({ max: { leftShoulder: 100, rightShoulder: 115 } });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('hips_rise_first', () => {
    const f = fault(deadliftDefinition, 'hips_rise_first');

    it('triggers when left hip change > left knee change + 30', () => {
      // hipChange = maxL hip - startL hip = 170 - 80 = 90
      // kneeChange = maxL knee - startL knee = 170 - 140 = 30
      // 90 > 30 + 30 = 60 ✓
      const c = ctx({
        start: { leftHip: 80, rightHip: 80, leftKnee: 140, rightKnee: 140 },
        max: { leftHip: 170, rightHip: 170, leftKnee: 170, rightKnee: 170 },
      });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (hip and knee rise together)', () => {
      // hipChange = 170 - 100 = 70
      // kneeChange = 170 - 120 = 50
      // 70 > 50 + 30 = 80? No
      const c = ctx({
        start: { leftHip: 100, rightHip: 100, leftKnee: 120, rightKnee: 120 },
        max: { leftHip: 170, rightHip: 170, leftKnee: 170, rightKnee: 170 },
      });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('asymmetric_pull', () => {
    const f = fault(deadliftDefinition, 'asymmetric_pull');

    it('triggers when |max left - max right hip| > 20', () => {
      const c = ctx({ max: { leftHip: 150, rightHip: 175 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (hip diff ≤ 20)', () => {
      const c = ctx({ max: { leftHip: 170, rightHip: 175 } });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('fast_descent', () => {
    const f = fault(deadliftDefinition, 'fast_descent');

    it('triggers when durationMs < 1200', () => {
      const c = ctx({ durationMs: 1000 });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (durationMs ≥ 1200)', () => {
      const c = ctx({ durationMs: 3000 });
      expect(f.condition(c)).toBe(false);
    });
  });
});

// =============================================================================
// RDL Faults
// =============================================================================

describe('rdl faults', () => {
  // Thresholds: standing=165, bottom=90, kneeMinBend=130

  describe('knee_bend_excessive', () => {
    const f = fault(rdlDefinition, 'knee_bend_excessive');

    it('triggers when min knee avg < kneeMinBend (130)', () => {
      // avg = (120 + 120) / 2 = 120 < 130
      const c = ctx({ min: { leftKnee: 120, rightKnee: 120 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (min knee avg ≥ 130)', () => {
      const c = ctx({ min: { leftKnee: 155, rightKnee: 155 } });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('shallow_hinge', () => {
    const f = fault(rdlDefinition, 'shallow_hinge');

    it('triggers when min hip avg > bottom + 20 (110)', () => {
      // avg = (115 + 115) / 2 = 115 > 110
      const c = ctx({ min: { leftHip: 115, rightHip: 115 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (min hip avg ≤ 110)', () => {
      const c = ctx({ min: { leftHip: 88, rightHip: 88 } });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('incomplete_lockout', () => {
    const f = fault(rdlDefinition, 'incomplete_lockout');

    it('triggers when max hip avg < standing - 10 (155)', () => {
      // avg = (150 + 150) / 2 = 150 < 155
      const c = ctx({ max: { leftHip: 150, rightHip: 150 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (max hip avg ≥ 155)', () => {
      const c = ctx({ max: { leftHip: 170, rightHip: 170 } });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('rounded_back', () => {
    const f = fault(rdlDefinition, 'rounded_back');

    it('triggers when max shoulder > 130', () => {
      const c = ctx({ max: { leftShoulder: 135, rightShoulder: 110 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (max shoulder ≤ 130)', () => {
      const c = ctx({ max: { leftShoulder: 100, rightShoulder: 125 } });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('asymmetric_hinge', () => {
    const f = fault(rdlDefinition, 'asymmetric_hinge');

    it('triggers when |min left - min right hip| > 20', () => {
      const c = ctx({ min: { leftHip: 80, rightHip: 110 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (hip diff ≤ 20)', () => {
      const c = ctx({ min: { leftHip: 85, rightHip: 90 } });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('fast_rep', () => {
    const f = fault(rdlDefinition, 'fast_rep');

    it('triggers when durationMs < 1500', () => {
      const c = ctx({ durationMs: 1000 });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (durationMs ≥ 1500)', () => {
      const c = ctx({ durationMs: 3000 });
      expect(f.condition(c)).toBe(false);
    });
  });
});

// =============================================================================
// Bench Press Faults
// =============================================================================

describe('benchpress faults', () => {
  // Thresholds: readyElbow=155, bottom=90, elbowFlareShoulderMax=120

  describe('incomplete_lockout', () => {
    const f = fault(benchpressDefinition, 'incomplete_lockout');

    it('triggers when end elbow avg < readyElbow - 10 (145)', () => {
      // avg = (140 + 140) / 2 = 140 < 145
      const c = ctx({ end: { leftElbow: 140, rightElbow: 140 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (end elbow avg ≥ 145)', () => {
      const c = ctx({ end: { leftElbow: 165, rightElbow: 165 } });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('shallow_depth', () => {
    const f = fault(benchpressDefinition, 'shallow_depth');

    it('triggers when min elbow avg > bottom + 15 (105)', () => {
      // avg = (110 + 110) / 2 = 110 > 105
      const c = ctx({ min: { leftElbow: 110, rightElbow: 110 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (min elbow avg ≤ 105)', () => {
      const c = ctx({ min: { leftElbow: 85, rightElbow: 85 } });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('asymmetric_press', () => {
    const f = fault(benchpressDefinition, 'asymmetric_press');

    it('triggers when |min left - min right elbow| > 20', () => {
      const c = ctx({ min: { leftElbow: 80, rightElbow: 110 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (elbow diff ≤ 20)', () => {
      const c = ctx({ min: { leftElbow: 85, rightElbow: 90 } });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('fast_rep', () => {
    const f = fault(benchpressDefinition, 'fast_rep');

    it('triggers when durationMs < 600', () => {
      const c = ctx({ durationMs: 400 });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (durationMs ≥ 600)', () => {
      const c = ctx({ durationMs: 2000 });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('elbow_flare', () => {
    const f = fault(benchpressDefinition, 'elbow_flare');

    it('triggers when max shoulder > elbowFlareShoulderMax (120)', () => {
      const c = ctx({ max: { leftShoulder: 125, rightShoulder: 110 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (max shoulder ≤ 120)', () => {
      const c = ctx({ max: { leftShoulder: 100, rightShoulder: 115 } });
      expect(f.condition(c)).toBe(false);
    });
  });
});

// =============================================================================
// Dead Hang Faults
// =============================================================================

describe('dead hang faults', () => {
  // Thresholds: elbowExtended=150, shoulderElevation=115, minHoldMs=1500

  describe('bent_arms', () => {
    const f = fault(deadHangDefinition, 'bent_arms');

    it('triggers when min elbow avg < elbowExtended - 10 (140)', () => {
      // avg = (130 + 130) / 2 = 130 < 140
      const c = ctx({ min: { leftElbow: 130, rightElbow: 130 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (min elbow avg ≥ 140)', () => {
      const c = ctx({ min: { leftElbow: 165, rightElbow: 165 } });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('shrugged_shoulders', () => {
    const f = fault(deadHangDefinition, 'shrugged_shoulders');

    it('triggers when max shoulder > shoulderElevation (115)', () => {
      const c = ctx({ max: { leftShoulder: 120, rightShoulder: 100 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (max shoulder ≤ 115)', () => {
      const c = ctx({ max: { leftShoulder: 100, rightShoulder: 110 } });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('short_hold', () => {
    const f = fault(deadHangDefinition, 'short_hold');

    it('triggers when durationMs < minHoldMs (1500)', () => {
      const c = ctx({ durationMs: 1000 });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (durationMs ≥ 1500)', () => {
      const c = ctx({ durationMs: 30000 });
      expect(f.condition(c)).toBe(false);
    });
  });
});

// =============================================================================
// Farmers Walk Faults
// =============================================================================

describe('farmers walk faults', () => {
  // Thresholds: standingHip=165, hipAsymmetryMax=15, shoulderAsymmetryMax=15, shoulderElevated=75

  describe('lateral_lean', () => {
    const f = fault(farmersWalkDefinition, 'lateral_lean');

    it('triggers when |min left - min right hip| > hipAsymmetryMax (15)', () => {
      const c = ctx({ min: { leftHip: 155, rightHip: 175 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (hip diff ≤ 15)', () => {
      const c = ctx({ min: { leftHip: 170, rightHip: 175 } });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('shoulder_shrug', () => {
    const f = fault(farmersWalkDefinition, 'shoulder_shrug');

    it('triggers when min shoulder < shoulderElevated (75)', () => {
      // min(70, 90) = 70 < 75
      const c = ctx({ min: { leftShoulder: 70, rightShoulder: 90 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (min shoulder ≥ 75)', () => {
      const c = ctx({ min: { leftShoulder: 85, rightShoulder: 90 } });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('forward_lean', () => {
    const f = fault(farmersWalkDefinition, 'forward_lean');

    it('triggers when max hip avg < standingHip - 15 (150)', () => {
      // avg = (145 + 145) / 2 = 145 < 150
      const c = ctx({ max: { leftHip: 145, rightHip: 145 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (max hip avg ≥ 150)', () => {
      const c = ctx({ max: { leftHip: 175, rightHip: 175 } });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('asymmetric_shoulders', () => {
    const f = fault(farmersWalkDefinition, 'asymmetric_shoulders');

    it('triggers when |min left - min right shoulder| > shoulderAsymmetryMax (15)', () => {
      const c = ctx({ min: { leftShoulder: 75, rightShoulder: 95 } });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (shoulder diff ≤ 15)', () => {
      const c = ctx({ min: { leftShoulder: 85, rightShoulder: 90 } });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('short_carry', () => {
    const f = fault(farmersWalkDefinition, 'short_carry');

    it('triggers when durationMs < 5000', () => {
      const c = ctx({ durationMs: 4000 });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (durationMs ≥ 5000)', () => {
      const c = ctx({ durationMs: 30000 });
      expect(f.condition(c)).toBe(false);
    });
  });

  describe('rushed_pickup', () => {
    const f = fault(farmersWalkDefinition, 'rushed_pickup');

    it('triggers when durationMs < 3000', () => {
      const c = ctx({ durationMs: 2500 });
      expect(f.condition(c)).toBe(true);
    });

    it('does not trigger on good form (durationMs ≥ 3000)', () => {
      const c = ctx({ durationMs: 30000 });
      expect(f.condition(c)).toBe(false);
    });
  });
});
