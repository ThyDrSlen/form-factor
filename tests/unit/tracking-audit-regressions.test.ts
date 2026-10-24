import { act, renderHook } from '@testing-library/react-native';
import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import { useWorkoutController } from '@/features/form-tracking/hooks/use-workout-controller';
import { OcclusionHoldManager } from '@/lib/tracking-quality/occlusion';

// Keep the real workout registry, curl FSM, and adaptive timing functions.
// Stub only output side effects; these tests never write to a database/device.
jest.mock('@/lib/haptics/haptic-bus', () => ({ hapticBus: { emit: jest.fn() } }));
jest.mock('@/lib/services/rep-logger', () => ({ logRep: jest.fn().mockResolvedValue('audit-rep') }));
jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(), warnWithTs: jest.fn(), errorWithTs: jest.fn(), infoWithTs: jest.fn(),
}));
jest.mock('@/lib/services/fqi-calculator', () => ({
  calculateFqi: jest.fn().mockReturnValue({ score: 90, detectedFaults: [] }),
  extractRepFeatures: jest.fn().mockImplementation((_angles, durationMs) => ({ durationMs })),
}));

function angles(elbow: number): JointAngles {
  return {
    leftElbow: elbow, rightElbow: elbow,
    leftShoulder: 90, rightShoulder: 90,
    leftHip: 175, rightHip: 175, leftKnee: 175, rightKnee: 175,
  };
}

describe('tracking audit: current curl duration, not time since previous rep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  async function replayCurl(extraTopHoldMs: number) {
    const onRepComplete = jest.fn();
    const hook = renderHook(() => useWorkoutController('dumbbell_curl', {
      sessionId: 'tracking-audit', enableHaptics: false, callbacks: { onRepComplete },
    }));
    const transition = async (elbow: number) => {
      await act(async () => {
        hook.result.current.processFrame(angles(elbow));
        jest.advanceTimersByTime(50); // Real adaptive phase hold is 40ms at full quality.
        hook.result.current.processFrame(angles(elbow));
      });
    };
    await transition(170); // setup -> bottom
    await transition(130); // bottom -> curling; actual rep starts now
    await transition(60); // curling -> top
    await act(async () => { jest.advanceTimersByTime(extraTopHoldMs); });
    await transition(110); // top -> lowering
    await transition(170); // lowering -> bottom; rep ends
    return { ...hook, onRepComplete };
  }

  it('control: counts a curl whose active duration exceeds the 600ms minimum', async () => {
    const { result, onRepComplete, unmount } = await replayCurl(600);
    expect(result.current.state.repCount).toBe(1);
    expect(onRepComplete).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('rejects a first curl with only 150ms active duration despite an old last-rep timestamp', async () => {
    const { result, onRepComplete, unmount } = await replayCurl(0);
    expect(result.current.state.phase).toBe('bottom');
    const count = result.current.state.repCount;
    unmount();
    expect(count).toBe(0);
    expect(onRepComplete).not.toHaveBeenCalled();
  });
});

describe('tracking audit: sustained occlusion survives coordinate-hold expiry', () => {
  it.each(['record', 'map'] as const)('fires at 30 missing frames with default holdFrames (%s)', (kind) => {
    const onSustainedOcclusion = jest.fn();
    const manager = new OcclusionHoldManager({ sustainFrames: 30, onSustainedOcclusion });
    const good = { x: 0.2, y: 0.3, isTracked: true, confidence: 0.9 };
    if (kind === 'record') {
      manager.update({ left_elbow: good });
      for (let i = 0; i < 30; i++) manager.update({ left_elbow: null });
    } else {
      manager.update(new Map([['left_elbow', good]]));
      for (let i = 0; i < 30; i++) manager.update(new Map());
    }
    expect(onSustainedOcclusion).toHaveBeenCalledTimes(1);
    expect(manager.getSustainedOccludedJoints()).toEqual(['left_elbow']);
  });
});
