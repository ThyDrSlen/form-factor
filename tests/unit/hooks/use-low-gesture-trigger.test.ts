/**
 * Unit tests for useLowGestureTrigger — hand-below-hip alternate recording
 * gesture (issue #428 Gap 5).
 */
import { renderHook } from '@testing-library/react-native';
import {
  handsBelowHips,
  useLowGestureTrigger,
  type LowGestureJoint,
} from '@/hooks/use-low-gesture-trigger';

function joint(name: string, y: number, isTracked = true): LowGestureJoint {
  return { name, y, isTracked };
}

function skeleton(opts: {
  leftHandY: number;
  rightHandY: number;
  leftHipY: number;
  rightHipY: number;
  tracked?: boolean;
}): LowGestureJoint[] {
  const tracked = opts.tracked ?? true;
  return [
    joint('left_hand', opts.leftHandY, tracked),
    joint('right_hand', opts.rightHandY, tracked),
    joint('left_hip', opts.leftHipY, tracked),
    joint('right_hip', opts.rightHipY, tracked),
  ];
}

describe('handsBelowHips', () => {
  it('returns false when joint array is missing/empty', () => {
    expect(handsBelowHips(null)).toBe(false);
    expect(handsBelowHips(undefined)).toBe(false);
    expect(handsBelowHips([])).toBe(false);
  });

  it('returns false when required joints are not tracked', () => {
    const joints = skeleton({
      leftHandY: 0.9,
      rightHandY: 0.9,
      leftHipY: 0.5,
      rightHipY: 0.5,
      tracked: false,
    });
    expect(handsBelowHips(joints)).toBe(false);
  });

  it('returns true when both hands are clearly below both hips', () => {
    const joints = skeleton({
      leftHandY: 0.9,
      rightHandY: 0.88,
      leftHipY: 0.55,
      rightHipY: 0.5,
    });
    expect(handsBelowHips(joints)).toBe(true);
  });

  it('returns false when only one hand is below', () => {
    const joints = skeleton({
      leftHandY: 0.9,
      rightHandY: 0.4,
      leftHipY: 0.5,
      rightHipY: 0.5,
    });
    expect(handsBelowHips(joints)).toBe(false);
  });

  it('respects the marginY threshold', () => {
    // Hands barely below hips — smaller than default 0.04 margin.
    const joints = skeleton({
      leftHandY: 0.52,
      rightHandY: 0.52,
      leftHipY: 0.5,
      rightHipY: 0.5,
    });
    expect(handsBelowHips(joints)).toBe(false);
    expect(handsBelowHips(joints, 0.01)).toBe(true);
  });
});

describe('useLowGestureTrigger', () => {
  it('does not fire immediately when the gesture is first seen', () => {
    const onTrigger = jest.fn();
    const joints = skeleton({
      leftHandY: 0.9,
      rightHandY: 0.9,
      leftHipY: 0.5,
      rightHipY: 0.5,
    });
    let t = 1_000;
    renderHook(() =>
      useLowGestureTrigger({
        enabled: true,
        joints,
        onTrigger,
        now: () => t,
      }),
    );
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it('fires once the hold window is satisfied across frames', () => {
    const onTrigger = jest.fn();
    const joints = skeleton({
      leftHandY: 0.9,
      rightHandY: 0.9,
      leftHipY: 0.5,
      rightHipY: 0.5,
    });
    let t = 10_000;
    const { rerender } = renderHook(
      ({ frame }: { frame: number }) =>
        useLowGestureTrigger({
          enabled: true,
          joints,
          onTrigger,
          now: () => t,
          holdMs: 500,
          cooldownMs: 2000,
        }),
      { initialProps: { frame: 0 } },
    );
    // Advance the clock and re-render with a new joint reference to simulate
    // a fresh frame from the ARKit stream.
    t = 10_600; // 600 ms later — past 500 ms hold
    rerender({ frame: 1 });
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it('enforces the cooldown between successive triggers', () => {
    const onTrigger = jest.fn();
    const joints = skeleton({
      leftHandY: 0.9,
      rightHandY: 0.9,
      leftHipY: 0.5,
      rightHipY: 0.5,
    });
    let t = 10_000;
    const { rerender } = renderHook(
      ({ frame }: { frame: number }) =>
        useLowGestureTrigger({
          enabled: true,
          joints,
          onTrigger,
          now: () => t,
          holdMs: 300,
          cooldownMs: 2_000,
        }),
      { initialProps: { frame: 0 } },
    );
    t = 10_400;
    rerender({ frame: 1 });
    expect(onTrigger).toHaveBeenCalledTimes(1);

    // Another frame well past the hold window but inside the cooldown —
    // should not re-trigger.
    t = 11_500; // 1.1s after first trigger
    rerender({ frame: 2 });
    expect(onTrigger).toHaveBeenCalledTimes(1);

    // And one past the cooldown — allowed, but only if we've reset the hold
    // and then accumulated a fresh hold window.
    t = 12_600; // > cooldown
    rerender({ frame: 3 });
    t = 13_100; // fresh hold satisfied
    rerender({ frame: 4 });
    expect(onTrigger).toHaveBeenCalledTimes(2);
  });

  it('cancels the in-progress hold when the gesture breaks', () => {
    const onTrigger = jest.fn();
    const hold: LowGestureJoint[] = skeleton({
      leftHandY: 0.9,
      rightHandY: 0.9,
      leftHipY: 0.5,
      rightHipY: 0.5,
    });
    const released: LowGestureJoint[] = skeleton({
      leftHandY: 0.3,
      rightHandY: 0.3,
      leftHipY: 0.5,
      rightHipY: 0.5,
    });
    let t = 10_000;
    const { rerender } = renderHook(
      ({ joints }: { joints: LowGestureJoint[] }) =>
        useLowGestureTrigger({
          enabled: true,
          joints,
          onTrigger,
          now: () => t,
          holdMs: 500,
        }),
      { initialProps: { joints: hold } },
    );
    // Breaks gesture before hold completes.
    t = 10_200;
    rerender({ joints: released });
    // Come back to gesture but only briefly — should not fire (hold resets).
    t = 10_300;
    rerender({ joints: hold });
    t = 10_600; // only 300 ms since the new hold started
    rerender({ joints: hold });
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it('never fires when enabled is false', () => {
    const onTrigger = jest.fn();
    const joints = skeleton({
      leftHandY: 0.9,
      rightHandY: 0.9,
      leftHipY: 0.5,
      rightHipY: 0.5,
    });
    let t = 1_000;
    const { rerender } = renderHook(
      ({ frame }: { frame: number }) =>
        useLowGestureTrigger({
          enabled: false,
          joints,
          onTrigger,
          now: () => t,
        }),
      { initialProps: { frame: 0 } },
    );
    t = 10_000;
    rerender({ frame: 1 });
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it('exposes a reset() that clears any pending hold', () => {
    const onTrigger = jest.fn();
    const joints = skeleton({
      leftHandY: 0.9,
      rightHandY: 0.9,
      leftHipY: 0.5,
      rightHipY: 0.5,
    });
    let t = 10_000;
    const { result, rerender } = renderHook(
      ({ frame }: { frame: number }) =>
        useLowGestureTrigger({
          enabled: true,
          joints,
          onTrigger,
          now: () => t,
          holdMs: 500,
        }),
      { initialProps: { frame: 0 } },
    );
    t = 10_200;
    rerender({ frame: 1 });
    // Caller hits the manual record button — reset any pending hold.
    result.current.reset();
    t = 10_400;
    rerender({ frame: 2 });
    expect(onTrigger).not.toHaveBeenCalled();
  });
});
