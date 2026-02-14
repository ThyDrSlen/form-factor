import type { CanonicalJoint2D } from '@/lib/pose/types';
import {
  PULLUP_CRITICAL_JOINTS,
  areRequiredJointsVisible,
  getConfidenceTier,
  getVisibilityTier,
  isJointVisible,
} from '@/lib/tracking-quality/visibility';

function joint(input: Partial<CanonicalJoint2D> & Pick<CanonicalJoint2D, 'x' | 'y' | 'isTracked'>): CanonicalJoint2D {
  return {
    x: input.x,
    y: input.y,
    isTracked: input.isTracked,
    confidence: input.confidence,
  };
}

describe('tracking-quality visibility helpers', () => {
  test('tier classification at boundaries', () => {
    expect(getConfidenceTier(0.29)).toBe('low');
    expect(getConfidenceTier(0.3)).toBe('medium');
    expect(getConfidenceTier(0.59)).toBe('medium');
    expect(getConfidenceTier(0.6)).toBe('high');

    expect(getVisibilityTier(0.29)).toBe('missing');
    expect(getVisibilityTier(0.3)).toBe('weak');
    expect(getVisibilityTier(0.59)).toBe('weak');
    expect(getVisibilityTier(0.6)).toBe('trusted');
  });

  test('isJointVisible respects isTracked and minConfidence', () => {
    expect(isJointVisible(null, 0.3)).toBe(false);
    expect(isJointVisible(joint({ x: 0, y: 0, isTracked: false, confidence: 0.99 }), 0.3)).toBe(false);
    expect(isJointVisible(joint({ x: 0, y: 0, isTracked: true, confidence: 0.29 }), 0.3)).toBe(false);
    expect(isJointVisible(joint({ x: 0, y: 0, isTracked: true, confidence: 0.3 }), 0.3)).toBe(true);

    expect(isJointVisible(joint({ x: 0, y: 0, isTracked: true }), 0.3)).toBe(true);
  });

  test('areRequiredJointsVisible supports "any-of" specs', () => {
    const joints: Record<string, CanonicalJoint2D | null> = {
      left_shoulder: joint({ x: 0.1, y: 0.2, isTracked: true, confidence: 0.9 }),
      right_shoulder: joint({ x: 0.9, y: 0.2, isTracked: true, confidence: 0.9 }),
      left_forearm: joint({ x: 0.15, y: 0.35, isTracked: true, confidence: 0.8 }),
      right_forearm: joint({ x: 0.85, y: 0.35, isTracked: true, confidence: 0.8 }),
    };

    expect(areRequiredJointsVisible(joints, [['left_elbow', 'left_forearm']], 0.3)).toBe(true);
    expect(areRequiredJointsVisible(joints, [['left_elbow', 'left_wrist']], 0.3)).toBe(false);
  });

  test('pull-up critical joints do not depend on head/face keys', () => {
    const flattened = PULLUP_CRITICAL_JOINTS.flatMap((spec) => (typeof spec === 'string' ? [spec] : spec));
    expect(flattened).not.toContain('head');
    expect(flattened).not.toContain('nose');
    expect(flattened).not.toContain('neck');
  });
});
