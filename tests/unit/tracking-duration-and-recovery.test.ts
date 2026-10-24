import { act, renderHook } from '@testing-library/react-native';
import { useWorkoutController } from '@/features/form-tracking/hooks/use-workout-controller';
import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import { OcclusionHoldManager } from '@/lib/tracking-quality/occlusion';

jest.mock('@/lib/haptics/haptic-bus', () => ({ hapticBus: { emit: jest.fn() } }));
jest.mock('@/lib/services/rep-logger', () => ({ logRep: jest.fn().mockResolvedValue('rep') }));
jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(), warnWithTs: jest.fn(), errorWithTs: jest.fn(), infoWithTs: jest.fn(),
}));

function angles(elbow: number): JointAngles {
  return {
    leftElbow: elbow, rightElbow: elbow,
    leftShoulder: 90, rightShoulder: 90,
    leftHip: 175, rightHip: 175, leftKnee: 175, rightKnee: 175,
  };
}

describe('curl duration recovery', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('accepts a valid curl after rejecting a short one, but not a short curl after resting', async () => {
    const onRepComplete = jest.fn();
    const { result, unmount } = renderHook(() => useWorkoutController('dumbbell_curl', {
      sessionId: 'duration-test', enableHaptics: false, callbacks: { onRepComplete },
    }));
    const transition = async (elbow: number) => {
      await act(async () => {
        result.current.processFrame(angles(elbow));
        jest.advanceTimersByTime(50);
        result.current.processFrame(angles(elbow));
      });
    };
    const curl = async (holdMs: number) => {
      await transition(130);
      await transition(60);
      await act(async () => { jest.advanceTimersByTime(holdMs); });
      await transition(110);
      await transition(170);
    };
    await transition(170);
    await curl(0);
    expect(result.current.state.repCount).toBe(0);
    await curl(600);
    expect(result.current.state.repCount).toBe(1);
    await act(async () => { jest.advanceTimersByTime(5000); });
    await curl(0);
    expect(result.current.state.repCount).toBe(1);
    expect(onRepComplete).toHaveBeenCalledTimes(1);
    unmount();
  });
});

describe('occlusion after coordinate expiry', () => {
  it('keeps coordinates unavailable, deduplicates alerts, then recovers and resets', () => {
    const onSustainedOcclusion = jest.fn();
    const manager = new OcclusionHoldManager({ holdFrames: 2, sustainFrames: 4, onSustainedOcclusion });
    const good = { x: 0.2, y: 0.3, isTracked: true, confidence: 0.9 };
    manager.update(new Map([['left_elbow', good]]));
    for (let i = 0; i < 8; i++) {
      const output = manager.update(new Map());
      if (i >= 2) expect(output.has('left_elbow')).toBe(false);
    }
    expect(onSustainedOcclusion).toHaveBeenCalledTimes(1);
    expect(manager.getSustainedOccludedJoints()).toEqual(['left_elbow']);
    expect(manager.update(new Map([['left_elbow', good]])).get('left_elbow')).toEqual(good);
    expect(manager.getSustainedOccludedJoints()).toEqual([]);
    for (let i = 0; i < 4; i++) manager.update(new Map());
    expect(onSustainedOcclusion).toHaveBeenCalledTimes(2);
    manager.reset();
    for (let i = 0; i < 8; i++) manager.update(new Map());
    expect(manager.getSustainedOccludedJoints()).toEqual([]);
    expect(onSustainedOcclusion).toHaveBeenCalledTimes(2);
  });
});
