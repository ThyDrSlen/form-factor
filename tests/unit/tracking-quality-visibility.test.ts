import type { CanonicalJoint2D } from '@/lib/pose/types';
import {
  JointStabilityTracker,
  PULLUP_CRITICAL_JOINTS,
  areRequiredJointsVisible,
  getConfidenceTier,
  getVisibilityTier,
  isJointVisible,
  setGlobalStabilityTracker,
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

describe('JointStabilityTracker', () => {
  test('returns null confidence for untracked joint', () => {
    const tracker = new JointStabilityTracker();
    expect(tracker.getJointConfidence('left_elbow')).toBeNull();
  });

  test('returns null confidence after only one frame (no deltas yet)', () => {
    const tracker = new JointStabilityTracker();
    tracker.update({ left_elbow: joint({ x: 0.5, y: 0.5, isTracked: true }) });
    // After first frame, count is 0 (no deltas recorded yet)
    expect(tracker.getJointConfidence('left_elbow')).toBeNull();
  });

  test('stable positions produce high synthetic confidence', () => {
    const tracker = new JointStabilityTracker({ windowSize: 5, maxVariance: 0.005 });

    // Feed 6 frames at essentially the same position (tiny jitter)
    for (let i = 0; i < 6; i++) {
      tracker.update({
        left_elbow: joint({ x: 0.5 + i * 0.0001, y: 0.5 + i * 0.0001, isTracked: true }),
      });
    }

    const confidence = tracker.getJointConfidence('left_elbow');
    expect(confidence).not.toBeNull();
    expect(confidence!).toBeGreaterThan(0.9);
  });

  test('jittery positions produce low synthetic confidence', () => {
    const tracker = new JointStabilityTracker({ windowSize: 5, maxVariance: 0.005 });

    // Feed frames with large alternating jumps
    for (let i = 0; i < 6; i++) {
      const offset = i % 2 === 0 ? 0.1 : -0.1;
      tracker.update({
        left_elbow: joint({ x: 0.5 + offset, y: 0.5 + offset, isTracked: true }),
      });
    }

    const confidence = tracker.getJointConfidence('left_elbow');
    expect(confidence).not.toBeNull();
    expect(confidence!).toBeLessThan(0.3);
  });

  test('tracks multiple joints independently', () => {
    const tracker = new JointStabilityTracker({ windowSize: 5, maxVariance: 0.005 });

    for (let i = 0; i < 6; i++) {
      const jitter = i % 2 === 0 ? 0.1 : -0.1;
      tracker.update({
        // Stable joint
        left_shoulder: joint({ x: 0.3 + i * 0.0001, y: 0.3, isTracked: true }),
        // Jittery joint
        left_elbow: joint({ x: 0.5 + jitter, y: 0.5 + jitter, isTracked: true }),
      });
    }

    const shoulderConf = tracker.getJointConfidence('left_shoulder')!;
    const elbowConf = tracker.getJointConfidence('left_elbow')!;

    expect(shoulderConf).toBeGreaterThan(0.9);
    expect(elbowConf).toBeLessThan(0.3);
  });

  test('reset clears all history', () => {
    const tracker = new JointStabilityTracker();
    tracker.update({ left_elbow: joint({ x: 0.5, y: 0.5, isTracked: true }) });
    tracker.update({ left_elbow: joint({ x: 0.5, y: 0.5, isTracked: true }) });
    expect(tracker.getJointConfidence('left_elbow')).not.toBeNull();

    tracker.reset();
    expect(tracker.getJointConfidence('left_elbow')).toBeNull();
  });

  test('ignores untracked joints in update', () => {
    const tracker = new JointStabilityTracker();
    tracker.update({ left_elbow: joint({ x: 0.5, y: 0.5, isTracked: false }) });
    expect(tracker.getJointConfidence('left_elbow')).toBeNull();
  });

  test('sliding window only keeps recent deltas', () => {
    const tracker = new JointStabilityTracker({ windowSize: 3, maxVariance: 0.005 });

    // First: 4 jittery frames (fills window with large deltas)
    for (let i = 0; i < 4; i++) {
      const offset = i % 2 === 0 ? 0.1 : -0.1;
      tracker.update({
        left_elbow: joint({ x: 0.5 + offset, y: 0.5, isTracked: true }),
      });
    }
    const jitteryConf = tracker.getJointConfidence('left_elbow')!;
    expect(jitteryConf).toBeLessThan(0.3);

    // Then: 4 stable frames (overwrites the window)
    for (let i = 0; i < 4; i++) {
      tracker.update({
        left_elbow: joint({ x: 0.5 + i * 0.00001, y: 0.5, isTracked: true }),
      });
    }
    const stableConf = tracker.getJointConfidence('left_elbow')!;
    expect(stableConf).toBeGreaterThan(0.9);
  });
});

describe('isJointVisible with stability tracker', () => {
  afterEach(() => {
    setGlobalStabilityTracker(null);
  });

  test('uses synthetic confidence when no native confidence and tracker provided', () => {
    const tracker = new JointStabilityTracker({ windowSize: 3, maxVariance: 0.005 });

    // Build up stable history -> high synthetic confidence
    for (let i = 0; i < 4; i++) {
      tracker.update({
        left_elbow: joint({ x: 0.5 + i * 0.0001, y: 0.5, isTracked: true }),
      });
    }

    // No native confidence, but tracker says it's stable -> visible
    const arkitJoint = joint({ x: 0.5, y: 0.5, isTracked: true });
    expect(isJointVisible(arkitJoint, 0.3, tracker, 'left_elbow')).toBe(true);
  });

  test('rejects joint when synthetic confidence is below threshold', () => {
    const tracker = new JointStabilityTracker({ windowSize: 3, maxVariance: 0.005 });

    // Build up jittery history -> low synthetic confidence
    for (let i = 0; i < 4; i++) {
      const offset = i % 2 === 0 ? 0.1 : -0.1;
      tracker.update({
        left_elbow: joint({ x: 0.5 + offset, y: 0.5 + offset, isTracked: true }),
      });
    }

    const arkitJoint = joint({ x: 0.5, y: 0.5, isTracked: true });
    expect(isJointVisible(arkitJoint, 0.3, tracker, 'left_elbow')).toBe(false);
  });

  test('native confidence takes priority over synthetic', () => {
    const tracker = new JointStabilityTracker({ windowSize: 3, maxVariance: 0.005 });

    // Build up jittery synthetic (would fail) but native confidence is high
    for (let i = 0; i < 4; i++) {
      const offset = i % 2 === 0 ? 0.1 : -0.1;
      tracker.update({
        left_elbow: joint({ x: 0.5 + offset, y: 0.5 + offset, isTracked: true }),
      });
    }

    // Joint with native confidence should use it, not synthetic
    const mediapipeJoint = joint({ x: 0.5, y: 0.5, isTracked: true, confidence: 0.95 });
    expect(isJointVisible(mediapipeJoint, 0.3, tracker, 'left_elbow')).toBe(true);
  });

  test('uses global stability tracker when no explicit tracker provided', () => {
    const tracker = new JointStabilityTracker({ windowSize: 3, maxVariance: 0.005 });

    // Build jittery history
    for (let i = 0; i < 4; i++) {
      const offset = i % 2 === 0 ? 0.1 : -0.1;
      tracker.update({
        left_elbow: joint({ x: 0.5 + offset, y: 0.5 + offset, isTracked: true }),
      });
    }

    setGlobalStabilityTracker(tracker);

    const arkitJoint = joint({ x: 0.5, y: 0.5, isTracked: true });
    // No tracker arg, but global is set -> uses synthetic -> fails
    expect(isJointVisible(arkitJoint, 0.3, undefined, 'left_elbow')).toBe(false);
  });

  test('falls through to true when no tracker and no confidence', () => {
    // No global tracker set, no explicit tracker, no confidence field
    const arkitJoint = joint({ x: 0.5, y: 0.5, isTracked: true });
    expect(isJointVisible(arkitJoint, 0.3)).toBe(true);
  });
});
