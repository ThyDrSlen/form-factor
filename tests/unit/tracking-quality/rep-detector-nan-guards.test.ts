/**
 * NaN / Infinity guard regression tests for the pull-up rep detector.
 *
 * Issue #417 finding #2: raw `input.angles.leftElbow` participated in
 * arithmetic without finite-checking, and `computeShoulderHandGap()`
 * computed `(a + b) / 2` before guarding the individual joints — so a
 * single tainted reading could propagate NaN/Infinity into baselineGap
 * and effectively stall the FSM.
 */

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import { RepDetectorPullup } from '@/lib/tracking-quality/rep-detector';

function baseAngles(overrides: Partial<JointAngles> = {}): JointAngles {
  return {
    leftKnee: 120,
    rightKnee: 120,
    leftElbow: 165,
    rightElbow: 165,
    leftHip: 140,
    rightHip: 140,
    leftShoulder: 92,
    rightShoulder: 92,
    ...overrides,
  };
}

function baseJoints(overrides?: Record<string, { x: number; y: number; isTracked: boolean; confidence?: number }>) {
  return {
    left_shoulder: { x: 0.4, y: 0.33, isTracked: true, confidence: 0.95 },
    right_shoulder: { x: 0.6, y: 0.33, isTracked: true, confidence: 0.95 },
    left_hand: { x: 0.35, y: 0.25, isTracked: true, confidence: 0.95 },
    right_hand: { x: 0.65, y: 0.25, isTracked: true, confidence: 0.95 },
    ...(overrides ?? {}),
  };
}

describe('RepDetectorPullup — NaN / Infinity guards', () => {
  it('freezes instead of crashing when leftElbow is NaN', () => {
    const detector = new RepDetectorPullup({ nConsecFrames: 1 });
    expect(() => {
      detector.step({
        timestampSec: 0,
        angles: baseAngles({ leftElbow: Number.NaN }),
        joints: baseJoints(),
      });
    }).not.toThrow();

    const snap = detector.getSnapshot();
    expect(snap.repCount).toBe(0);
    // frozenFrames should increment since angle input was invalid
    expect(snap.frozenFrames).toBe(1);
  });

  it('freezes when rightElbow is Infinity', () => {
    const detector = new RepDetectorPullup({ nConsecFrames: 1 });
    detector.step({
      timestampSec: 0,
      angles: baseAngles({ rightElbow: Number.POSITIVE_INFINITY }),
      joints: baseJoints(),
    });
    expect(detector.getSnapshot().frozenFrames).toBe(1);
  });

  it('computeShoulderHandGap returns null when a single shoulder y is NaN', () => {
    const detector = new RepDetectorPullup({ nConsecFrames: 1 });
    detector.step({
      timestampSec: 0,
      angles: baseAngles(),
      joints: baseJoints({
        left_shoulder: { x: 0.4, y: Number.NaN, isTracked: true, confidence: 0.95 },
      }),
    });
    // When gap is null the detector freezes — never touches the baseline.
    expect(detector.getSnapshot().baselineGap).toBeNull();
    expect(detector.getSnapshot().frozenFrames).toBe(1);
  });

  it('computeShoulderHandGap returns null when one hand y is Infinity', () => {
    const detector = new RepDetectorPullup({ nConsecFrames: 1 });
    detector.step({
      timestampSec: 0,
      angles: baseAngles(),
      joints: baseJoints({
        right_hand: { x: 0.65, y: Number.POSITIVE_INFINITY, isTracked: true, confidence: 0.95 },
      }),
    });
    expect(detector.getSnapshot().baselineGap).toBeNull();
  });

  it('keeps baselineGap finite across a tainted frame then a valid frame', () => {
    const detector = new RepDetectorPullup({ nConsecFrames: 1 });

    // Tainted-elbow frame freezes but may still seed baseline from joint gap.
    detector.step({
      timestampSec: 0,
      angles: baseAngles({ leftElbow: Number.NaN }),
      joints: baseJoints(),
    });
    const afterTainted = detector.getSnapshot();
    // Key invariant: whatever baselineGap ends up as, it must be finite
    // (no NaN carryover from the invalid elbow reading).
    if (afterTainted.baselineGap !== null) {
      expect(Number.isFinite(afterTainted.baselineGap)).toBe(true);
    }

    // Valid follow-up frame continues without poisoning baseline.
    detector.step({
      timestampSec: 1 / 30,
      angles: baseAngles(),
      joints: baseJoints(),
    });
    const afterValid = detector.getSnapshot();
    expect(afterValid.baselineGap).not.toBeNull();
    expect(Number.isFinite(afterValid.baselineGap ?? Number.NaN)).toBe(true);
  });

  it('resetCycle fires only after maxFrozenFrames of tainted input', () => {
    const detector = new RepDetectorPullup({ nConsecFrames: 1, maxFrozenFrames: 3 });
    for (let i = 0; i < 10; i += 1) {
      detector.step({
        timestampSec: i / 30,
        angles: baseAngles({ leftElbow: Number.NaN }),
        joints: baseJoints(),
      });
    }
    const snap = detector.getSnapshot();
    expect(snap.state).toBe('bottom');
    expect(snap.repCount).toBe(0);
  });
});
