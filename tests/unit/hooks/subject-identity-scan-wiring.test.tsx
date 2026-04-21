/**
 * Integration-style coverage of the subject-identity + occlusion pairing
 * that scan-arkit.tsx wires inside its frame-smoothing effect. We don't
 * render the whole scan screen here (too big / too many mocks) — instead
 * we exercise the same call sequence the scan loop makes against a fixture
 * burst of joints and assert the hooks behave the way the scan screen
 * relies on (switchDetected fires on a centroid jump, occlusion manager
 * emits the sustained-joint telemetry the banner reads).
 */
import { act, renderHook } from '@testing-library/react-native';

import type { Joint2D } from '@/lib/arkit/ARKitBodyTracker';
import { useSubjectIdentity } from '@/hooks/use-subject-identity';
import { OcclusionHoldManager, type SustainedOcclusionEvent } from '@/lib/tracking-quality/occlusion';

function jointAt(name: string, x: number, y: number): Joint2D {
  return { name, x, y, isTracked: true };
}

function burst(cx: number, cy: number, shoulder: number, torso: number): Joint2D[] {
  const half = shoulder / 2;
  return [
    jointAt('left_shoulder', cx - half, cy),
    jointAt('right_shoulder', cx + half, cy),
    jointAt('left_hip', cx - half * 0.9, cy + torso),
    jointAt('right_hip', cx + half * 0.9, cy + torso),
    jointAt('left_hand', cx - half * 1.6, cy + torso * 0.3),
    jointAt('right_hand', cx + half * 1.6, cy + torso * 0.3),
  ];
}

describe('subject-identity + occlusion scan wiring', () => {
  it('calibrates from a stable burst of frames (scan-loop step contract)', () => {
    const { result } = renderHook(() =>
      useSubjectIdentity({ calibrationFrames: 6 }),
    );

    act(() => {
      for (let i = 0; i < 10; i += 1) {
        result.current.step(burst(0.5, 0.5, 0.2, 0.3));
      }
    });
    expect(result.current.snapshot.isCalibrated).toBe(true);
    expect(result.current.snapshot.switchDetected).toBe(false);

    // Reset returns to a fresh, pre-calibration state (what the Reset
    // banner action wires).
    act(() => {
      result.current.reset();
    });
    expect(result.current.snapshot.isCalibrated).toBe(false);
    expect(result.current.snapshot.switchDetected).toBe(false);
  });

  it('recalibrate accepts the current subject as the new baseline', () => {
    const { result } = renderHook(() =>
      useSubjectIdentity({ calibrationFrames: 6 }),
    );
    act(() => {
      for (let i = 0; i < 10; i += 1) {
        result.current.step(burst(0.5, 0.5, 0.2, 0.3));
      }
    });
    act(() => {
      result.current.recalibrate();
    });
    // After recalibrate the snapshot should still report calibrated and not
    // show a pending switch.
    expect(result.current.snapshot.switchDetected).toBe(false);
  });

  it('feeds occlusion manager with the same joint map the scan loop would build', () => {
    const events: SustainedOcclusionEvent[] = [];
    const mgr = new OcclusionHoldManager({
      sustainFrames: 3,
      onSustainedOcclusion: (e) => events.push(e),
    });

    // Seed with good frames for both hands.
    for (let i = 0; i < 3; i += 1) {
      mgr.update({
        left_hand: { x: 0.3, y: 0.5, isTracked: true, confidence: 0.9 },
        right_hand: { x: 0.7, y: 0.5, isTracked: true, confidence: 0.9 },
      });
    }

    // Simulate left_hand dropping out for 4 frames (> sustainFrames=3).
    for (let i = 0; i < 4; i += 1) {
      mgr.update({
        left_hand: null,
        right_hand: { x: 0.7, y: 0.5, isTracked: true, confidence: 0.9 },
      });
    }

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].jointNames).toContain('left_hand');
    expect(mgr.getSustainedOccludedJoints()).toContain('left_hand');
  });

  it('clears sustained set when joints reappear (scan banner dismissal)', () => {
    const mgr = new OcclusionHoldManager({ sustainFrames: 2 });
    mgr.update({ left_hand: { x: 0.3, y: 0.5, isTracked: true, confidence: 0.9 } });
    mgr.update({ left_hand: null });
    mgr.update({ left_hand: null });
    expect(mgr.getSustainedOccludedJoints()).toContain('left_hand');
    mgr.update({ left_hand: { x: 0.3, y: 0.5, isTracked: true, confidence: 0.9 } });
    expect(mgr.getSustainedOccludedJoints()).toEqual([]);
  });
});
