import type { CanonicalJoint2D } from '@/lib/pose/types';
import {
  computeTrackingQuality,
  PULLUP_CRITICAL_JOINT_WEIGHTS,
  scorePullupWithComponentAvailability,
} from '@/lib/tracking-quality/scoring';
import { JointStabilityTracker } from '@/lib/tracking-quality/visibility';

function joint(input: Partial<CanonicalJoint2D> & Pick<CanonicalJoint2D, 'x' | 'y' | 'isTracked'>): CanonicalJoint2D {
  return {
    x: input.x,
    y: input.y,
    isTracked: input.isTracked,
    confidence: input.confidence,
  };
}

function baseAngles() {
  return {
    start: { leftElbow: 165, rightElbow: 165, leftShoulder: 95, rightShoulder: 95 },
    end: { leftElbow: 90, rightElbow: 90, leftShoulder: 105, rightShoulder: 105 },
    min: { leftElbow: 80, rightElbow: 90, leftShoulder: 85, rightShoulder: 85 },
    max: { leftElbow: 170, rightElbow: 170, leftShoulder: 125, rightShoulder: 125 },
  };
}

describe('pull-up tracking-quality component scoring', () => {
  test('partial visibility omits affected components (right arm below weak threshold)', () => {
    const joints: Record<string, CanonicalJoint2D | null> = {
      left_shoulder: joint({ x: 0.1, y: 0.2, isTracked: true, confidence: 0.95 }),
      right_shoulder: joint({ x: 0.9, y: 0.2, isTracked: true, confidence: 0.95 }),
      left_elbow: joint({ x: 0.15, y: 0.35, isTracked: true, confidence: 0.9 }),
      right_elbow: joint({ x: 0.85, y: 0.35, isTracked: true, confidence: 0.2 }),
    };

    const result = scorePullupWithComponentAvailability({
      repAngles: baseAngles(),
      durationMs: 1100,
      joints,
    });

    expect(result.missing_components).toContain('symmetry_score');
    expect(result.visibility_badge).toBe('partial');
    expect(result.components.torso_stability_score).not.toBeNull();
  });

  test('single weak component does not report a confident overall score', () => {
    const joints: Record<string, CanonicalJoint2D | null> = {
      left_shoulder: joint({ x: 0.1, y: 0.2, isTracked: true, confidence: 0.31 }),
      right_shoulder: joint({ x: 0.9, y: 0.2, isTracked: true, confidence: 0.31 }),
      left_elbow: joint({ x: 0.15, y: 0.35, isTracked: false, confidence: 0.99 }),
      right_elbow: joint({ x: 0.85, y: 0.35, isTracked: false, confidence: 0.99 }),
    };

    const result = scorePullupWithComponentAvailability({
      repAngles: baseAngles(),
      durationMs: 1100,
      joints,
    });

    expect(result.components.torso_stability_score).not.toBeNull();
    expect(result.missing_components).toEqual(
      expect.arrayContaining(['rom_score', 'symmetry_score', 'tempo_score'])
    );
    expect(result.score_suppressed).toBe(true);
    expect(result.overall_score).not.toBeNull();
    expect(result.overall_score as number).toBeLessThanOrEqual(result.components.torso_stability_score as number);
  });

  test('full visibility computes all components and marks full badge', () => {
    const joints: Record<string, CanonicalJoint2D | null> = {
      left_shoulder: joint({ x: 0.1, y: 0.2, isTracked: true, confidence: 0.9 }),
      right_shoulder: joint({ x: 0.9, y: 0.2, isTracked: true, confidence: 0.9 }),
      left_elbow: joint({ x: 0.15, y: 0.35, isTracked: true, confidence: 0.9 }),
      right_elbow: joint({ x: 0.85, y: 0.35, isTracked: true, confidence: 0.9 }),
    };

    const result = scorePullupWithComponentAvailability({
      repAngles: baseAngles(),
      durationMs: 1100,
      joints,
    });

    expect(result.visibility_badge).toBe('full');
    expect(result.missing_components).toEqual([]);
    expect(result.components.rom_score).not.toBeNull();
    expect(result.components.symmetry_score).not.toBeNull();
    expect(result.components.tempo_score).not.toBeNull();
    expect(result.components.torso_stability_score).not.toBeNull();
    expect(result.score_suppressed).toBe(false);
    expect(result.overall_score).not.toBeNull();
  });

  test('live frame scoring should not treat missing confidence as fully visible (RED)', () => {
    const joints: Record<string, CanonicalJoint2D | null> = {
      left_shoulder: joint({ x: 0.1, y: 0.2, isTracked: true }),
      right_shoulder: joint({ x: 0.9, y: 0.2, isTracked: true }),
      left_elbow: joint({ x: 0.15, y: 0.35, isTracked: true }),
      right_elbow: joint({ x: 0.85, y: 0.35, isTracked: true }),
    };

    const result = scorePullupWithComponentAvailability({
      repAngles: baseAngles(),
      durationMs: 0,
      joints,
    });

    expect(result.visibility_badge).toBe('partial');
  });
});

describe('computeTrackingQuality', () => {
  test('returns 0 when joints is null', () => {
    const tracker = new JointStabilityTracker();
    expect(computeTrackingQuality(null, tracker, PULLUP_CRITICAL_JOINT_WEIGHTS)).toBe(0);
  });

  test('returns 0 when criticalJoints is empty', () => {
    const tracker = new JointStabilityTracker();
    const joints = { left_elbow: joint({ x: 0.5, y: 0.5, isTracked: true, confidence: 0.9 }) };
    expect(computeTrackingQuality(joints, tracker, [])).toBe(0);
  });

  test('uses native confidence when available', () => {
    const tracker = new JointStabilityTracker();
    const joints: Record<string, CanonicalJoint2D | null> = {
      left_elbow: joint({ x: 0.15, y: 0.35, isTracked: true, confidence: 0.8 }),
      right_elbow: joint({ x: 0.85, y: 0.35, isTracked: true, confidence: 0.6 }),
      left_shoulder: joint({ x: 0.1, y: 0.2, isTracked: true, confidence: 1.0 }),
      right_shoulder: joint({ x: 0.9, y: 0.2, isTracked: true, confidence: 1.0 }),
    };

    const quality = computeTrackingQuality(joints, tracker, PULLUP_CRITICAL_JOINT_WEIGHTS);
    // Weighted: 0.8*0.3 + 0.6*0.3 + 1.0*0.2 + 1.0*0.2 = 0.24+0.18+0.2+0.2 = 0.82
    expect(quality).toBeCloseTo(0.82, 2);
  });

  test('uses synthetic confidence when no native confidence (ARKit joints)', () => {
    const tracker = new JointStabilityTracker({ windowSize: 3, maxVariance: 0.005 });

    // Build stable history for all joints
    for (let i = 0; i < 4; i++) {
      tracker.update({
        left_elbow: joint({ x: 0.15 + i * 0.0001, y: 0.35, isTracked: true }),
        right_elbow: joint({ x: 0.85 + i * 0.0001, y: 0.35, isTracked: true }),
        left_shoulder: joint({ x: 0.1 + i * 0.0001, y: 0.2, isTracked: true }),
        right_shoulder: joint({ x: 0.9 + i * 0.0001, y: 0.2, isTracked: true }),
      });
    }

    const joints: Record<string, CanonicalJoint2D | null> = {
      left_elbow: joint({ x: 0.15, y: 0.35, isTracked: true }),
      right_elbow: joint({ x: 0.85, y: 0.35, isTracked: true }),
      left_shoulder: joint({ x: 0.1, y: 0.2, isTracked: true }),
      right_shoulder: joint({ x: 0.9, y: 0.2, isTracked: true }),
    };

    const quality = computeTrackingQuality(joints, tracker, PULLUP_CRITICAL_JOINT_WEIGHTS);
    // All joints are stable, so synthetic confidence should be high
    expect(quality).toBeGreaterThan(0.8);
  });

  test('jittery ARKit joints produce low quality score', () => {
    const tracker = new JointStabilityTracker({ windowSize: 3, maxVariance: 0.005 });

    // Build jittery history for elbow joints (highest weight)
    for (let i = 0; i < 4; i++) {
      const jitter = i % 2 === 0 ? 0.1 : -0.1;
      tracker.update({
        left_elbow: joint({ x: 0.15 + jitter, y: 0.35 + jitter, isTracked: true }),
        right_elbow: joint({ x: 0.85 + jitter, y: 0.35 + jitter, isTracked: true }),
        left_shoulder: joint({ x: 0.1 + i * 0.0001, y: 0.2, isTracked: true }),
        right_shoulder: joint({ x: 0.9 + i * 0.0001, y: 0.2, isTracked: true }),
      });
    }

    const joints: Record<string, CanonicalJoint2D | null> = {
      left_elbow: joint({ x: 0.15, y: 0.35, isTracked: true }),
      right_elbow: joint({ x: 0.85, y: 0.35, isTracked: true }),
      left_shoulder: joint({ x: 0.1, y: 0.2, isTracked: true }),
      right_shoulder: joint({ x: 0.9, y: 0.2, isTracked: true }),
    };

    const quality = computeTrackingQuality(joints, tracker, PULLUP_CRITICAL_JOINT_WEIGHTS);
    // Elbows are jittery (0.6 of weight), shoulders stable (0.4 of weight)
    expect(quality).toBeLessThan(0.5);
  });

  test('untracked joints contribute 0 to quality', () => {
    const tracker = new JointStabilityTracker();
    const joints: Record<string, CanonicalJoint2D | null> = {
      left_elbow: joint({ x: 0.15, y: 0.35, isTracked: false }),
      right_elbow: joint({ x: 0.85, y: 0.35, isTracked: true, confidence: 0.9 }),
      left_shoulder: joint({ x: 0.1, y: 0.2, isTracked: true, confidence: 0.9 }),
      right_shoulder: joint({ x: 0.9, y: 0.2, isTracked: true, confidence: 0.9 }),
    };

    const quality = computeTrackingQuality(joints, tracker, PULLUP_CRITICAL_JOINT_WEIGHTS);
    // left_elbow (0.3) untracked = 0, rest = 0.9
    // (0*0.3 + 0.9*0.3 + 0.9*0.2 + 0.9*0.2) / 1.0 = 0.63
    expect(quality).toBeCloseTo(0.63, 2);
  });

  test('works with Map-based joints', () => {
    const tracker = new JointStabilityTracker();
    const joints = new Map<string, CanonicalJoint2D>();
    joints.set('left_elbow', joint({ x: 0.15, y: 0.35, isTracked: true, confidence: 0.8 }));
    joints.set('right_elbow', joint({ x: 0.85, y: 0.35, isTracked: true, confidence: 0.8 }));
    joints.set('left_shoulder', joint({ x: 0.1, y: 0.2, isTracked: true, confidence: 0.8 }));
    joints.set('right_shoulder', joint({ x: 0.9, y: 0.2, isTracked: true, confidence: 0.8 }));

    const quality = computeTrackingQuality(joints, tracker, PULLUP_CRITICAL_JOINT_WEIGHTS);
    expect(quality).toBeCloseTo(0.8, 2);
  });

  test('PULLUP_CRITICAL_JOINT_WEIGHTS sum to 1.0', () => {
    const sum = PULLUP_CRITICAL_JOINT_WEIGHTS.reduce((acc, w) => acc + w.weight, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });
});
