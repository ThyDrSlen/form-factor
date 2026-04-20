import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';
import {
  generateFaultExplanation,
  generateFaultExplanationDetail,
  renderExplanation,
  listExplainedFaultIds,
  hasExplanationFor,
} from '@/lib/services/fault-explainability';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function mkAngles(overrides: Partial<JointAngles> = {}): JointAngles {
  return {
    leftKnee: 120,
    rightKnee: 120,
    leftElbow: 180,
    rightElbow: 180,
    leftHip: 90,
    rightHip: 90,
    leftShoulder: 90,
    rightShoulder: 90,
    ...overrides,
  };
}

function mkRep(overrides: Partial<RepContext> = {}): RepContext {
  const base: RepContext = {
    startAngles: mkAngles(),
    endAngles: mkAngles(),
    minAngles: mkAngles(),
    maxAngles: mkAngles(),
    durationMs: 2000,
    repNumber: 1,
    workoutId: 'deadlift',
  };
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// Registry sanity
// ---------------------------------------------------------------------------

describe('fault-explainability registry', () => {
  it('lists at least the six required faults', () => {
    const ids = listExplainedFaultIds();
    expect(ids).toContain('hips_rise_first');
    expect(ids).toContain('forward_lean');
    expect(ids).toContain('lateral_lean');
    expect(ids).toContain('incomplete_lockout');
    expect(ids).toContain('knee_valgus');
    expect(ids).toContain('elbow_flare');
  });

  it('reports hasExplanationFor for known and unknown ids', () => {
    expect(hasExplanationFor('hips_rise_first')).toBe(true);
    expect(hasExplanationFor('__not_a_real_fault__')).toBe(false);
  });

  it('lists ids alphabetically', () => {
    const ids = listExplainedFaultIds();
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });
});

// ---------------------------------------------------------------------------
// Unknown fault fallback
// ---------------------------------------------------------------------------

describe('unknown fault fallback', () => {
  it('returns a safe generic explanation for unknown faultId', () => {
    const exp = generateFaultExplanationDetail(
      'unknown_fault_xyz',
      mkRep(),
      'deadlift',
    );
    expect(exp.faultId).toBe('unknown_fault_xyz');
    expect(exp.workoutId).toBe('deadlift');
    expect(exp.title.length).toBeGreaterThan(0);
    expect(exp.rationale.length).toBeGreaterThan(0);
    expect(exp.cue.length).toBeGreaterThan(0);
    // No angle deltas surfaced for unknown faults.
    expect(Object.keys(exp.metrics)).toHaveLength(0);
  });

  it('flattens an unknown-fault explanation to a single sentence string', () => {
    const text = generateFaultExplanation('mystery', mkRep(), 'squat');
    expect(text).toContain('Form issue');
    expect(text).toContain('mystery');
  });
});

// ---------------------------------------------------------------------------
// hips_rise_first
// ---------------------------------------------------------------------------

describe('hips_rise_first', () => {
  it('reports hip-lead delta in degrees and returns the matching faultId', () => {
    const rep = mkRep({
      startAngles: mkAngles({ leftHip: 80, leftKnee: 110 }),
      maxAngles: mkAngles({ leftHip: 170, leftKnee: 150 }),
    });
    const detail = generateFaultExplanationDetail(
      'hips_rise_first',
      rep,
      'deadlift',
    );
    expect(detail.faultId).toBe('hips_rise_first');
    // hip: 80 -> 170 = 90; knee: 110 -> 150 = 40; lead = 50
    expect(detail.metrics.hipChangeDeg).toBe(90);
    expect(detail.metrics.kneeChangeDeg).toBe(40);
    expect(detail.metrics.hipLeadDeg).toBe(50);
    expect(detail.rationale).toContain('hip-lead');
    expect(detail.cue.length).toBeGreaterThan(0);
    expect(detail.repNumber).toBe(1);
  });

  it('carries the rep number through from the context', () => {
    const detail = generateFaultExplanationDetail(
      'hips_rise_first',
      mkRep({ repNumber: 5 }),
      'deadlift',
    );
    expect(detail.repNumber).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// forward_lean
// ---------------------------------------------------------------------------

describe('forward_lean', () => {
  it('squat variant surfaces min-hip vs min-knee gap', () => {
    const rep = mkRep({
      minAngles: mkAngles({
        leftHip: 60,
        rightHip: 60,
        leftKnee: 100,
        rightKnee: 100,
      }),
    });
    const detail = generateFaultExplanationDetail(
      'forward_lean',
      rep,
      'squat',
    );
    expect(detail.metrics.minHipDeg).toBe(60);
    expect(detail.metrics.minKneeDeg).toBe(100);
    expect(detail.metrics.leanGapDeg).toBe(40);
    expect(detail.title.toLowerCase()).toContain('chest');
  });

  it('farmers_walk variant surfaces hip-shortfall from upright', () => {
    const rep = mkRep({
      maxAngles: mkAngles({ leftHip: 150, rightHip: 150 }),
    });
    const detail = generateFaultExplanationDetail(
      'forward_lean',
      rep,
      'farmers_walk',
    );
    expect(detail.metrics.peakHipDeg).toBe(150);
    expect(detail.metrics.shortfallFromUprightDeg).toBe(30);
    expect(detail.title.toLowerCase()).toContain('trunk');
  });
});

// ---------------------------------------------------------------------------
// lateral_lean
// ---------------------------------------------------------------------------

describe('lateral_lean', () => {
  it('reports absolute hip asymmetry', () => {
    const rep = mkRep({
      minAngles: mkAngles({ leftHip: 70, rightHip: 95 }),
    });
    const detail = generateFaultExplanationDetail(
      'lateral_lean',
      rep,
      'farmers_walk',
    );
    expect(detail.metrics.hipAsymmetryDeg).toBe(25);
    expect(detail.metrics.leftHipDeg).toBe(70);
    expect(detail.metrics.rightHipDeg).toBe(95);
    expect(detail.title.toLowerCase()).toContain('lean');
  });
});

// ---------------------------------------------------------------------------
// incomplete_lockout (dispatched by workoutId)
// ---------------------------------------------------------------------------

describe('incomplete_lockout', () => {
  it('pushup variant references elbow shortfall', () => {
    const rep = mkRep({
      endAngles: mkAngles({ leftElbow: 140, rightElbow: 140 }),
    });
    const detail = generateFaultExplanationDetail(
      'incomplete_lockout',
      rep,
      'pushup',
    );
    expect(detail.metrics.endElbowDeg).toBe(140);
    expect(detail.metrics.shortfallFromLockoutDeg).toBe(40);
    expect(detail.title.toLowerCase()).toContain('lock out');
  });

  it('benchpress variant shares the elbow dispatch', () => {
    const rep = mkRep({
      endAngles: mkAngles({ leftElbow: 160, rightElbow: 160 }),
    });
    const detail = generateFaultExplanationDetail(
      'incomplete_lockout',
      rep,
      'benchpress',
    );
    expect(detail.metrics.endElbowDeg).toBe(160);
    expect(detail.metrics.shortfallFromLockoutDeg).toBe(20);
  });

  it('squat variant references knee shortfall', () => {
    const rep = mkRep({
      endAngles: mkAngles({ leftKnee: 150, rightKnee: 150 }),
    });
    const detail = generateFaultExplanationDetail(
      'incomplete_lockout',
      rep,
      'squat',
    );
    expect(detail.metrics.endKneeDeg).toBe(150);
    expect(detail.metrics.shortfallFromLockoutDeg).toBe(30);
    expect(detail.rationale.toLowerCase()).toContain('stand');
  });

  it('deadlift variant references hip shortfall', () => {
    const rep = mkRep({
      maxAngles: mkAngles({ leftHip: 150, rightHip: 150 }),
    });
    const detail = generateFaultExplanationDetail(
      'incomplete_lockout',
      rep,
      'deadlift',
    );
    expect(detail.metrics.peakHipDeg).toBe(150);
    expect(detail.metrics.shortfallFromLockoutDeg).toBe(30);
    expect(detail.rationale.toLowerCase()).toContain('hip');
  });

  it('rdl variant defaults to hip as well', () => {
    const rep = mkRep({
      maxAngles: mkAngles({ leftHip: 160, rightHip: 160 }),
    });
    const detail = generateFaultExplanationDetail(
      'incomplete_lockout',
      rep,
      'rdl',
    );
    expect(detail.metrics.peakHipDeg).toBe(160);
    expect(detail.metrics.shortfallFromLockoutDeg).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// knee_valgus
// ---------------------------------------------------------------------------

describe('knee_valgus', () => {
  it('reports knee asymmetry and dominant side', () => {
    const rep = mkRep({
      minAngles: mkAngles({ leftKnee: 75, rightKnee: 105 }),
    });
    const detail = generateFaultExplanationDetail(
      'knee_valgus',
      rep,
      'squat',
    );
    expect(detail.metrics.kneeAsymmetryDeg).toBe(30);
    expect(detail.metrics.leftKneeDeg).toBe(75);
    expect(detail.metrics.rightKneeDeg).toBe(105);
    // left bent further => dominant side is 'left'
    expect(detail.rationale.toLowerCase()).toContain('left knee');
  });

  it('identifies right side when right knee bends further', () => {
    const rep = mkRep({
      minAngles: mkAngles({ leftKnee: 110, rightKnee: 80 }),
    });
    const detail = generateFaultExplanationDetail(
      'knee_valgus',
      rep,
      'squat',
    );
    expect(detail.rationale.toLowerCase()).toContain('right knee');
  });
});

// ---------------------------------------------------------------------------
// elbow_flare
// ---------------------------------------------------------------------------

describe('elbow_flare', () => {
  it('reports shoulder abduction past 120° threshold', () => {
    const rep = mkRep({
      maxAngles: mkAngles({ leftShoulder: 130, rightShoulder: 145 }),
    });
    const detail = generateFaultExplanationDetail(
      'elbow_flare',
      rep,
      'benchpress',
    );
    expect(detail.metrics.peakShoulderDeg).toBe(145);
    expect(detail.metrics.degreesPastThreshold).toBe(25);
    expect(detail.rationale.toLowerCase()).toContain('chest');
  });

  it('references triceps for pushup variant', () => {
    const rep = mkRep({
      maxAngles: mkAngles({ leftShoulder: 135, rightShoulder: 135 }),
    });
    const detail = generateFaultExplanationDetail(
      'elbow_flare',
      rep,
      'pushup',
    );
    expect(detail.rationale.toLowerCase()).toContain('triceps');
  });

  it('reports zero degreesPastThreshold when under 120°', () => {
    const rep = mkRep({
      maxAngles: mkAngles({ leftShoulder: 100, rightShoulder: 110 }),
    });
    const detail = generateFaultExplanationDetail(
      'elbow_flare',
      rep,
      'benchpress',
    );
    // max shoulder = 110, so 110 - 120 clamped to 0
    expect(detail.metrics.degreesPastThreshold).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Bonus faults — smoke coverage
// ---------------------------------------------------------------------------

describe('bonus fault templates', () => {
  it('shallow_depth (pushup) surfaces elbow gap from 90°', () => {
    const rep = mkRep({
      minAngles: mkAngles({ leftElbow: 130, rightElbow: 130 }),
    });
    const detail = generateFaultExplanationDetail(
      'shallow_depth',
      rep,
      'pushup',
    );
    expect(detail.metrics.minElbowDeg).toBe(130);
    expect(detail.metrics.gapFromTargetDeg).toBe(40);
  });

  it('shallow_depth (squat) surfaces knee gap from parallel', () => {
    const rep = mkRep({
      minAngles: mkAngles({ leftKnee: 115, rightKnee: 115 }),
    });
    const detail = generateFaultExplanationDetail(
      'shallow_depth',
      rep,
      'squat',
    );
    expect(detail.metrics.minKneeDeg).toBe(115);
    expect(detail.metrics.gapFromParallelDeg).toBe(25);
  });

  it('rounded_back reports max shoulder angle', () => {
    const rep = mkRep({
      maxAngles: mkAngles({ leftShoulder: 140, rightShoulder: 135 }),
    });
    const detail = generateFaultExplanationDetail(
      'rounded_back',
      rep,
      'deadlift',
    );
    expect(detail.metrics.maxShoulderDeg).toBe(140);
  });

  it('asymmetric_pull reports hip diff', () => {
    const rep = mkRep({
      maxAngles: mkAngles({ leftHip: 160, rightHip: 140 }),
    });
    const detail = generateFaultExplanationDetail(
      'asymmetric_pull',
      rep,
      'deadlift',
    );
    expect(detail.metrics.hipAsymmetryDeg).toBe(20);
  });

  it('asymmetric_press reports elbow diff', () => {
    const rep = mkRep({
      minAngles: mkAngles({ leftElbow: 80, rightElbow: 105 }),
    });
    const detail = generateFaultExplanationDetail(
      'asymmetric_press',
      rep,
      'benchpress',
    );
    expect(detail.metrics.elbowAsymmetryDeg).toBe(25);
  });

  it('hip_sag reports sag depth below 160°', () => {
    const rep = mkRep({
      minAngles: mkAngles({ leftHip: 140, rightHip: 150 }),
    });
    const detail = generateFaultExplanationDetail(
      'hip_sag',
      rep,
      'pushup',
    );
    expect(detail.metrics.minHipDeg).toBe(140);
    expect(detail.metrics.sagBelowNeutralDeg).toBe(20);
  });

  it('hip_shift flags the side that dropped', () => {
    const rep = mkRep({
      minAngles: mkAngles({ leftHip: 60, rightHip: 85 }),
    });
    const detail = generateFaultExplanationDetail(
      'hip_shift',
      rep,
      'squat',
    );
    expect(detail.metrics.hipShiftDeg).toBe(25);
    expect(detail.rationale.toLowerCase()).toContain('left');
  });

  it('fast_rep reports duration in seconds', () => {
    const detail = generateFaultExplanationDetail(
      'fast_rep',
      mkRep({ durationMs: 800 }),
      'squat',
    );
    expect(detail.metrics.durationMs).toBe(800);
    expect(detail.rationale).toContain('0.8s');
  });

  it('fast_descent reports duration', () => {
    const detail = generateFaultExplanationDetail(
      'fast_descent',
      mkRep({ durationMs: 1100 }),
      'deadlift',
    );
    expect(detail.metrics.durationMs).toBe(1100);
  });

  it('incomplete_rom reports min elbow angle', () => {
    const rep = mkRep({
      minAngles: mkAngles({ leftElbow: 110, rightElbow: 110 }),
    });
    const detail = generateFaultExplanationDetail(
      'incomplete_rom',
      rep,
      'pullup',
    );
    expect(detail.metrics.minElbowDeg).toBe(110);
  });
});

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

describe('renderExplanation + generateFaultExplanation (string)', () => {
  it('flattens a structured detail to "title. rationale cue"', () => {
    const detail = generateFaultExplanationDetail(
      'hips_rise_first',
      mkRep({
        startAngles: mkAngles({ leftHip: 80, leftKnee: 110 }),
        maxAngles: mkAngles({ leftHip: 170, leftKnee: 150 }),
      }),
      'deadlift',
    );
    const flat = renderExplanation(detail);
    expect(flat.startsWith(detail.title)).toBe(true);
    expect(flat).toContain(detail.rationale);
    expect(flat).toContain(detail.cue);
  });

  it('generateFaultExplanation matches renderExplanation(detail)', () => {
    const rep = mkRep({
      minAngles: mkAngles({ leftKnee: 75, rightKnee: 105 }),
    });
    const detail = generateFaultExplanationDetail(
      'knee_valgus',
      rep,
      'squat',
    );
    expect(generateFaultExplanation('knee_valgus', rep, 'squat')).toBe(
      renderExplanation(detail),
    );
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge-case robustness', () => {
  it('never produces "NaN" in rationale strings', () => {
    const rep = mkRep({
      startAngles: mkAngles({ leftHip: NaN, leftKnee: NaN }),
      maxAngles: mkAngles({ leftHip: NaN, leftKnee: NaN }),
    });
    const detail = generateFaultExplanationDetail(
      'hips_rise_first',
      rep,
      'deadlift',
    );
    expect(detail.rationale).not.toContain('NaN');
  });

  it('never produces "Infinity" in rationale strings', () => {
    const rep = mkRep({
      durationMs: Infinity,
    });
    const detail = generateFaultExplanationDetail('fast_rep', rep, 'squat');
    expect(detail.rationale).not.toContain('Infinity');
  });

  it('returns workoutId untouched on the detail payload', () => {
    const detail = generateFaultExplanationDetail(
      'lateral_lean',
      mkRep(),
      'farmers_walk',
    );
    expect(detail.workoutId).toBe('farmers_walk');
  });

  it('rationale never ends with a dangling placeholder (no "${" substrings)', () => {
    const ids = listExplainedFaultIds();
    for (const id of ids) {
      const detail = generateFaultExplanationDetail(id, mkRep(), 'deadlift');
      expect(detail.rationale).not.toContain('${');
      expect(detail.cue).not.toContain('${');
    }
  });
});
