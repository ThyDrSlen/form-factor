import { act, renderHook } from '@testing-library/react-native';
import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import { useWorkoutController } from '@/features/form-tracking/hooks/use-workout-controller';
import * as fqiCalculator from '@/lib/services/fqi-calculator';
import { logRep } from '@/lib/services/rep-logger';
import { hapticBus } from '@/lib/haptics/haptic-bus';

jest.mock('@/lib/haptics/haptic-bus', () => ({ hapticBus: { emit: jest.fn() } }));
jest.mock('@/lib/services/rep-logger', () => ({ logRep: jest.fn().mockResolvedValue('test-rep') }));
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

// Real curl phases and scoring, with the deepest flexion on the top transition.
const frames = [
  [1, 170], [51, 170], [52, 130], [102, 130], [103, 60],
  [153, 45], [754, 110], [804, 110], [805, 170], [855, 175],
] as const;

describe('workout controller rep angle coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it.each(['live', 'replay'] as const)('includes transition and completion angles in %s scoring', async (executionMode) => {
    const extract = jest.spyOn(fqiCalculator, 'extractRepFeatures');
    const onRepComplete = jest.fn();
    const { result } = renderHook(() => useWorkoutController('dumbbell_curl', {
      sessionId: 'extrema', executionMode, callbacks: { onRepComplete },
    }));
    const epoch = Date.now();
    for (const [timestampMs, elbow] of frames) {
      jest.setSystemTime(epoch + timestampMs);
      await act(async () => result.current.processFrame(angles(elbow), undefined, { timestampMs }));
    }
    expect(result.current.state.repCount).toBe(1);
    expect(onRepComplete).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledWith(expect.objectContaining({
      start: expect.objectContaining({ leftElbow: 130, rightElbow: 130 }),
      min: expect.objectContaining({ leftElbow: 45, rightElbow: 45 }),
      max: expect.objectContaining({ leftElbow: 175, rightElbow: 175 }),
      end: expect.objectContaining({ leftElbow: 175, rightElbow: 175 }),
    }), expect.any(Number));
    if (executionMode === 'replay') {
      expect(logRep).not.toHaveBeenCalled();
      expect(hapticBus.emit).not.toHaveBeenCalled();
    } else {
      expect(logRep).toHaveBeenCalledTimes(1);
      expect(logRep).toHaveBeenCalledWith(expect.objectContaining({
        features: extract.mock.results[0].value,
        fqi: onRepComplete.mock.calls[0][1],
      }));
      expect(hapticBus.emit).toHaveBeenCalledTimes(1);
    }
  });

  it.each([153, 804, 855])('detects body swing on the transition at %ims without contaminating the next rep', async (faultTime) => {
    const extract = jest.spyOn(fqiCalculator, 'extractRepFeatures');
    const onRepComplete = jest.fn();
    const { result } = renderHook(() => useWorkoutController('dumbbell_curl', {
      sessionId: 'fault-replay', executionMode: 'replay', callbacks: { onRepComplete },
    }));
    for (const [timestampMs, elbow] of frames) {
      const frame = angles(elbow);
      if (timestampMs === faultTime) {
        frame.leftHip = 135;
        frame.rightHip = 140;
        frame.leftShoulder = 120;
        frame.rightShoulder = 115;
        frame.leftKnee = 145;
        frame.rightKnee = 150;
      }
      await act(async () => result.current.processFrame(frame, undefined, { timestampMs }));
    }
    expect(extract).toHaveBeenCalledWith(expect.objectContaining({
      min: {
        leftElbow: 45, rightElbow: 45, leftHip: 135, rightHip: 140,
        leftShoulder: 90, rightShoulder: 90, leftKnee: 145, rightKnee: 150,
      },
      max: {
        leftElbow: 175, rightElbow: 175, leftHip: 175, rightHip: 175,
        leftShoulder: 120, rightShoulder: 115, leftKnee: 175, rightKnee: 175,
      },
    }), expect.any(Number));
    expect(onRepComplete).toHaveBeenCalledWith(1, expect.any(Number), expect.arrayContaining(['swinging']));

    for (const [timestampMs, elbow] of frames) {
      await act(async () => result.current.processFrame(angles(elbow), undefined, { timestampMs: timestampMs + 1000 }));
    }
    expect(result.current.state.repCount).toBe(2);
    expect(onRepComplete).toHaveBeenCalledTimes(2);
    expect(onRepComplete.mock.calls[1][2]).not.toContain('swinging');
    expect(extract.mock.calls[1][0].min.leftHip).toBe(175);
    expect(extract.mock.calls[1][0].max.leftShoulder).toBe(90);
  });
});
