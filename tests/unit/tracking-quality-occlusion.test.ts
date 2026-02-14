import type { CanonicalJoint2D } from '@/lib/pose/types';
import { HOLD_FRAMES } from '@/lib/tracking-quality';
import { OcclusionHoldManager } from '@/lib/tracking-quality/occlusion';
import { PULLUP_CRITICAL_JOINTS, areRequiredJointsVisible } from '@/lib/tracking-quality/visibility';

function tracked(x: number, y: number, confidence: number): CanonicalJoint2D {
  return { x, y, isTracked: true, confidence };
}

function missing(x = 0, y = 0, confidence = 0): CanonicalJoint2D {
  return { x, y, isTracked: false, confidence };
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
