import type { CanonicalJoint2D } from '@/lib/pose/types';
import { HOLD_FRAMES } from '@/lib/tracking-quality';
import { OcclusionHoldManager } from '@/lib/tracking-quality/occlusion';
import { JointStabilityTracker, PULLUP_CRITICAL_JOINTS, areRequiredJointsVisible } from '@/lib/tracking-quality/visibility';

function tracked(x: number, y: number, confidence: number): CanonicalJoint2D {
  return { x, y, isTracked: true, confidence };
}

function missing(x = 0, y = 0, confidence = 0): CanonicalJoint2D {
  return { x, y, isTracked: false, confidence };
}

/** ARKit-style joint: isTracked=true but no confidence field */
function arkitJoint(x: number, y: number): CanonicalJoint2D {
  return { x, y, isTracked: true };
}

describe('tracking-quality occlusion hold/decay', () => {
  test('brief occlusion uses hold-last-good, decays, then recovers', () => {
    const manager = new OcclusionHoldManager({ holdFrames: HOLD_FRAMES, decayFactorPerFrame: 0.85 });

    const key = 'left_elbow';
    const frame0 = { [key]: tracked(0.1, 0.2, 0.95) };
    const frame1 = { [key]: missing(0.99, 0.99, 0.05) };
    const frame2 = { [key]: missing(0.98, 0.98, 0.05) };
    const frame3 = { [key]: missing(0.97, 0.97, 0.05) };
    const frame4 = { [key]: tracked(0.15, 0.25, 0.9) };

    const out0 = manager.update(frame0);
    expect(out0[key]?.x).toBeCloseTo(0.1);
    expect(out0[key]?.y).toBeCloseTo(0.2);
    expect(out0[key]?.confidence).toBeCloseTo(0.95);

    const out1 = manager.update(frame1);
    const out2 = manager.update(frame2);
    const out3 = manager.update(frame3);

    expect(out1[key]?.x).toBeCloseTo(0.1);
    expect(out2[key]?.x).toBeCloseTo(0.1);
    expect(out3[key]?.x).toBeCloseTo(0.1);

    expect((out1[key]?.confidence ?? 1)).toBeLessThan(0.95);
    expect((out2[key]?.confidence ?? 1)).toBeLessThan(out1[key]?.confidence ?? 1);
    expect((out3[key]?.confidence ?? 1)).toBeLessThan(out2[key]?.confidence ?? 1);

    const out4 = manager.update(frame4);
    expect(out4[key]?.x).toBeCloseTo(0.15);
    expect(out4[key]?.y).toBeCloseTo(0.25);
    expect(out4[key]?.confidence).toBeCloseTo(0.9);
  });

  test('long occlusion expires hold and marks joint unavailable', () => {
    const manager = new OcclusionHoldManager({ holdFrames: HOLD_FRAMES, decayFactorPerFrame: 0.85 });
    const key = 'right_elbow';

    manager.update({ [key]: tracked(0.2, 0.3, 0.9) });

    let last: Record<string, CanonicalJoint2D | null | undefined> = {};
    for (let i = 0; i < HOLD_FRAMES + 2; i += 1) {
      last = manager.update({ [key]: missing(0, 0, 0.05) });
    }

    expect(last[key]).toBeNull();
  });

  test('downstream required-joint check fails after hold expiry', () => {
    const manager = new OcclusionHoldManager({ holdFrames: HOLD_FRAMES, decayFactorPerFrame: 0.85 });

    const base = {
      left_shoulder: tracked(0.4, 0.3, 0.9),
      right_shoulder: tracked(0.6, 0.3, 0.9),
      left_elbow: tracked(0.45, 0.45, 0.9),
      right_elbow: tracked(0.55, 0.45, 0.9),
    };

    manager.update(base);

    let out: Record<string, CanonicalJoint2D | null | undefined> = base;
    for (let i = 0; i < HOLD_FRAMES + 2; i += 1) {
      out = manager.update({ ...base, right_elbow: missing(0, 0, 0.05) });
    }

    expect(areRequiredJointsVisible(out, PULLUP_CRITICAL_JOINTS, 0.3)).toBe(false);
  });
});

describe('soft occlusion detection', () => {
  test('isSoftOccluded returns false when no stability tracker is set', () => {
    const manager = new OcclusionHoldManager();
    expect(manager.isSoftOccluded('left_elbow')).toBe(false);
  });

  test('joint becomes soft-occluded after consecutive low-confidence frames', () => {
    const tracker = new JointStabilityTracker({ windowSize: 3, maxVariance: 0.005 });
    const manager = new OcclusionHoldManager({
      holdFrames: HOLD_FRAMES,
      stabilityTracker: tracker,
      softOcclusionThreshold: 0.3,
      softOcclusionConsecFrames: 3,
    });

    const key = 'left_elbow';

    // First: establish a good baseline with stable data
    for (let i = 0; i < 4; i++) {
      const frame = { [key]: arkitJoint(0.5 + i * 0.0001, 0.5) };
      tracker.update(frame);
      manager.update(frame);
    }
    expect(manager.isSoftOccluded(key)).toBe(false);

    // Now: introduce jitter (large position jumps) that will drive variance up
    for (let i = 0; i < 6; i++) {
      const jitter = i % 2 === 0 ? 0.15 : -0.15;
      const frame = { [key]: arkitJoint(0.5 + jitter, 0.5 + jitter) };
      tracker.update(frame);
      manager.update(frame);
    }

    // After enough jittery frames, the joint should be soft-occluded
    expect(manager.isSoftOccluded(key)).toBe(true);
  });

  test('soft occlusion holds a position and decays confidence', () => {
    const tracker = new JointStabilityTracker({ windowSize: 3, maxVariance: 0.005 });
    const manager = new OcclusionHoldManager({
      holdFrames: HOLD_FRAMES,
      stabilityTracker: tracker,
      softOcclusionThreshold: 0.3,
      softOcclusionConsecFrames: 3,
    });

    const key = 'left_elbow';

    // Establish good baseline
    for (let i = 0; i < 4; i++) {
      const frame = { [key]: arkitJoint(0.5 + i * 0.0001, 0.5) };
      tracker.update(frame);
      manager.update(frame);
    }

    // Introduce jitter — once soft occlusion triggers, position is held
    const outputs: (CanonicalJoint2D | null | undefined)[] = [];
    for (let i = 0; i < 6; i++) {
      const jitter = i % 2 === 0 ? 0.15 : -0.15;
      const frame = { [key]: arkitJoint(0.5 + jitter, 0.5 + jitter) };
      tracker.update(frame);
      const out = manager.update(frame);
      outputs.push(out[key]);
    }

    expect(manager.isSoftOccluded(key)).toBe(true);

    // Once occluded, the held output should have decaying confidence
    const lastOutput = outputs[outputs.length - 1];
    expect(lastOutput).toBeDefined();
    expect(lastOutput!.isTracked).toBe(true);
    expect(typeof lastOutput!.confidence).toBe('number');
    // The held confidence should be lower than the original (decayed)
    expect(lastOutput!.confidence!).toBeLessThan(0.9);
  });

  test('soft occlusion clears when confidence recovers', () => {
    const tracker = new JointStabilityTracker({ windowSize: 3, maxVariance: 0.005 });
    const manager = new OcclusionHoldManager({
      holdFrames: HOLD_FRAMES,
      stabilityTracker: tracker,
      softOcclusionThreshold: 0.3,
      softOcclusionConsecFrames: 3,
    });

    const key = 'left_elbow';

    // Establish baseline
    for (let i = 0; i < 4; i++) {
      const frame = { [key]: arkitJoint(0.5 + i * 0.0001, 0.5) };
      tracker.update(frame);
      manager.update(frame);
    }

    // Make it jittery to trigger soft occlusion
    for (let i = 0; i < 6; i++) {
      const jitter = i % 2 === 0 ? 0.15 : -0.15;
      const frame = { [key]: arkitJoint(0.5 + jitter, 0.5 + jitter) };
      tracker.update(frame);
      manager.update(frame);
    }

    // Now stabilize again
    for (let i = 0; i < 6; i++) {
      const frame = { [key]: arkitJoint(0.5 + i * 0.00001, 0.5) };
      tracker.update(frame);
      manager.update(frame);
    }

    // Should recover from soft occlusion
    expect(manager.isSoftOccluded(key)).toBe(false);
  });

  test('soft occlusion does not apply to joints with native confidence', () => {
    const tracker = new JointStabilityTracker({ windowSize: 3, maxVariance: 0.005 });
    const manager = new OcclusionHoldManager({
      holdFrames: HOLD_FRAMES,
      stabilityTracker: tracker,
      softOcclusionThreshold: 0.3,
      softOcclusionConsecFrames: 3,
    });

    const key = 'left_elbow';

    // Even with jitter in tracker, joints with native confidence pass through
    for (let i = 0; i < 6; i++) {
      const jitter = i % 2 === 0 ? 0.15 : -0.15;
      const frame = { [key]: tracked(0.5 + jitter, 0.5 + jitter, 0.9) };
      tracker.update(frame);
      manager.update(frame);
    }

    // Should NOT be soft-occluded because the joint has native confidence
    expect(manager.isSoftOccluded(key)).toBe(false);
  });

  test('setStabilityTracker enables soft occlusion after construction', () => {
    const tracker = new JointStabilityTracker({ windowSize: 3, maxVariance: 0.005 });
    const manager = new OcclusionHoldManager({
      holdFrames: HOLD_FRAMES,
      softOcclusionThreshold: 0.3,
      softOcclusionConsecFrames: 3,
    });

    const key = 'left_elbow';

    // No tracker initially — soft occlusion disabled
    for (let i = 0; i < 4; i++) {
      const frame = { [key]: arkitJoint(0.5 + i * 0.0001, 0.5) };
      tracker.update(frame);
      manager.update(frame);
    }

    // Set tracker after the fact
    manager.setStabilityTracker(tracker);

    // Now jitter should trigger soft occlusion
    for (let i = 0; i < 6; i++) {
      const jitter = i % 2 === 0 ? 0.15 : -0.15;
      const frame = { [key]: arkitJoint(0.5 + jitter, 0.5 + jitter) };
      tracker.update(frame);
      manager.update(frame);
    }

    expect(manager.isSoftOccluded(key)).toBe(true);
  });

  test('reset clears soft occlusion state', () => {
    const tracker = new JointStabilityTracker({ windowSize: 3, maxVariance: 0.005 });
    const manager = new OcclusionHoldManager({
      holdFrames: HOLD_FRAMES,
      stabilityTracker: tracker,
      softOcclusionThreshold: 0.3,
      softOcclusionConsecFrames: 3,
    });

    const key = 'left_elbow';

    // Build up soft occlusion
    for (let i = 0; i < 4; i++) {
      const frame = { [key]: arkitJoint(0.5 + i * 0.0001, 0.5) };
      tracker.update(frame);
      manager.update(frame);
    }
    for (let i = 0; i < 6; i++) {
      const jitter = i % 2 === 0 ? 0.15 : -0.15;
      const frame = { [key]: arkitJoint(0.5 + jitter, 0.5 + jitter) };
      tracker.update(frame);
      manager.update(frame);
    }

    manager.reset();
    expect(manager.isSoftOccluded(key)).toBe(false);
  });
});
