import { act, renderHook } from '@testing-library/react-native';
import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import { useWorkoutController } from '@/features/form-tracking/hooks/use-workout-controller';
import * as fqiCalculator from '@/lib/services/fqi-calculator';
import { logRep } from '@/lib/services/rep-logger';
import { hapticBus } from '@/lib/haptics/haptic-bus';

// Keep the real curl FSM, adaptive timing and scoring; isolate output effects.
jest.mock('@/lib/haptics/haptic-bus', () => ({ hapticBus: { emit: jest.fn() } }));
jest.mock('@/lib/services/rep-logger', () => ({ logRep: jest.fn().mockResolvedValue('continuity-test') }));
jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(), warnWithTs: jest.fn(), errorWithTs: jest.fn(), infoWithTs: jest.fn(),
}));

function angles(elbow: number): JointAngles {
  return {
    leftElbow: elbow, rightElbow: elbow, leftShoulder: 90, rightShoulder: 90,
    leftHip: 175, rightHip: 175, leftKnee: 175, rightKnee: 175,
  };
}

const curlFrames = [
  [1, 170], [51, 170], [52, 130], [102, 130], [103, 60],
  [153, 45], [754, 110], [804, 110], [805, 170], [855, 175],
] as const;

describe('workout controller live clock continuity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('discards unfinished motion on clock rollback and requires a fresh curl', async () => {
    const onRepComplete = jest.fn();
    const onReset = jest.fn();
    const extract = jest.spyOn(fqiCalculator, 'extractRepFeatures');
    const { result } = renderHook(() => useWorkoutController('dumbbell_curl', {
      sessionId: 'rollback', onReset, callbacks: { onRepComplete },
    }));
    const feed = async (frames: readonly (readonly [number, number])[]) => {
      for (const [time, elbow] of frames) {
        jest.setSystemTime(10000 + time);
        await act(async () => result.current.processFrame(angles(elbow)));
      }
    };

    // Keep an already completed rep while interrupting a second at its pending end.
    await feed(curlFrames);
    await feed(curlFrames.slice(0, -1).map(([time, elbow]) => [time + 1000, elbow] as const));
    expect(result.current.state.phase).toBe('lowering');
    expect(result.current.state.repCount).toBe(1);
    result.current.addRepCue('interrupted-cue');
    extract.mockClear();
    onRepComplete.mockClear();
    jest.mocked(logRep).mockClear();
    jest.mocked(hapticBus.emit).mockClear();

    // Clock moves backwards by 50ms, then catches up. This is not a new curl.
    await feed([[1755, 175], [1855, 175]]);
    expect(result.current.state.repCount).toBe(1);
    expect(onRepComplete).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
    expect(logRep).not.toHaveBeenCalled();
    expect(hapticBus.emit).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();

    await feed(curlFrames.map(([time, elbow]) => [time + 2000, elbow] as const));
    expect(result.current.state.repCount).toBe(2);
    expect(onRepComplete).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledWith(expect.objectContaining({
      min: expect.objectContaining({ leftElbow: 45 }),
    }), 753);
    expect(logRep).toHaveBeenCalledWith(expect.objectContaining({ repIndex: 2, cuesEmitted: [] }));
    expect(hapticBus.emit).toHaveBeenCalledTimes(1);
  });
});
