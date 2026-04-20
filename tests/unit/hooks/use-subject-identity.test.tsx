import { act, renderHook } from '@testing-library/react-native';

import type { Joint2D } from '@/lib/arkit/ARKitBodyTracker';
import { useSubjectIdentity } from '@/hooks/use-subject-identity';

function jointAt(name: string, x: number, y: number, isTracked = true): Joint2D {
  return { name, x, y, isTracked };
}

function frame(cx: number, cy: number, shoulderWidth: number, torso: number): Joint2D[] {
  const halfShoulder = shoulderWidth / 2;
  return [
    jointAt('left_shoulder', cx - halfShoulder, cy),
    jointAt('right_shoulder', cx + halfShoulder, cy),
    jointAt('left_hip', cx - halfShoulder * 0.9, cy + torso),
    jointAt('right_hip', cx + halfShoulder * 0.9, cy + torso),
    jointAt('left_hand', cx - halfShoulder * 1.6, cy + torso * 0.3),
    jointAt('right_hand', cx + halfShoulder * 1.6, cy + torso * 0.3),
  ];
}

describe('useSubjectIdentity', () => {
  it('starts uncalibrated with default snapshot', () => {
    const { result } = renderHook(() => useSubjectIdentity());
    expect(result.current.snapshot.isCalibrated).toBe(false);
    expect(result.current.snapshot.switchDetected).toBe(false);
    expect(result.current.snapshot.isOriginalSubject).toBe(true);
  });

  it('calibrates after stable frames and surfaces the transition', () => {
    const { result } = renderHook(() =>
      useSubjectIdentity({ calibrationFrames: 6 }),
    );
    act(() => {
      for (let i = 0; i < 10; i += 1) {
        result.current.step(frame(0.5, 0.5, 0.2, 0.3));
      }
    });
    expect(result.current.snapshot.isCalibrated).toBe(true);
    expect(result.current.snapshot.switchDetected).toBe(false);
  });

  it('flags switchDetected when signature changes sharply', () => {
    const { result } = renderHook(() =>
      useSubjectIdentity({
        calibrationFrames: 5,
        consecSwitchFrames: 2,
        maxSignatureDeviation: 0.2,
      }),
    );
    act(() => {
      for (let i = 0; i < 8; i += 1) {
        result.current.step(frame(0.5, 0.5, 0.2, 0.3));
      }
    });
    expect(result.current.snapshot.isCalibrated).toBe(true);

    act(() => {
      for (let i = 0; i < 6; i += 1) {
        // Dramatically different proportions: wider shoulders + shorter torso.
        result.current.step(frame(0.5, 0.5, 0.4, 0.15));
      }
    });
    expect(result.current.snapshot.switchDetected).toBe(true);
    expect(result.current.snapshot.isOriginalSubject).toBe(false);
  });

  it('recalibrate clears switchDetected', () => {
    const { result } = renderHook(() =>
      useSubjectIdentity({
        calibrationFrames: 4,
        consecSwitchFrames: 2,
        maxSignatureDeviation: 0.15,
      }),
    );
    act(() => {
      for (let i = 0; i < 6; i += 1) {
        result.current.step(frame(0.5, 0.5, 0.2, 0.3));
      }
      for (let i = 0; i < 6; i += 1) {
        result.current.step(frame(0.5, 0.5, 0.4, 0.15));
      }
    });
    expect(result.current.snapshot.switchDetected).toBe(true);

    act(() => {
      result.current.recalibrate();
    });
    expect(result.current.snapshot.switchDetected).toBe(false);
    expect(result.current.snapshot.recalibrated).toBe(true);
  });

  it('reset returns tracker to uncalibrated state', () => {
    const { result } = renderHook(() =>
      useSubjectIdentity({ calibrationFrames: 3 }),
    );
    act(() => {
      for (let i = 0; i < 5; i += 1) {
        result.current.step(frame(0.5, 0.5, 0.2, 0.3));
      }
    });
    expect(result.current.snapshot.isCalibrated).toBe(true);

    act(() => {
      result.current.reset();
    });
    expect(result.current.snapshot.isCalibrated).toBe(false);
  });

  it('no-ops when disabled', () => {
    const { result } = renderHook(() =>
      useSubjectIdentity({ calibrationFrames: 3, enabled: false }),
    );
    act(() => {
      for (let i = 0; i < 5; i += 1) {
        result.current.step(frame(0.5, 0.5, 0.2, 0.3));
      }
    });
    expect(result.current.snapshot.isCalibrated).toBe(false);
  });
});
