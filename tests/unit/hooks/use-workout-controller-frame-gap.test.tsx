import { act, renderHook } from '@testing-library/react-native';
import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import { useWorkoutController } from '@/features/form-tracking/hooks/use-workout-controller';
import * as fqiCalculator from '@/lib/services/fqi-calculator';
import { logRep } from '@/lib/services/rep-logger';
import { hapticBus } from '@/lib/haptics/haptic-bus';
import { ExerciseRecorder, ExerciseReplay } from '@/lib/debug/exercise-replay';
import { computeAdaptivePhaseHoldMs } from '@/lib/services/workout-runtime';

// Exercise the real registry, curl FSM, adaptive timing and FQI; isolate outputs only.
jest.mock('@/lib/haptics/haptic-bus', () => ({ hapticBus: { emit: jest.fn() } }));
jest.mock('@/lib/services/rep-logger', () => ({ logRep: jest.fn().mockResolvedValue('gap-test') }));
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

type Frame = readonly [number, number];
type Controller = ReturnType<typeof useWorkoutController>;
async function feed(result: { current: Controller }, frames: readonly Frame[]) {
  for (const [timestampMs, elbow] of frames) {
    jest.setSystemTime(timestampMs);
    await act(async () => result.current.processFrame(angles(elbow), undefined, { timestampMs }));
  }
}

describe('workout controller silent frame gaps', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(logRep).mockResolvedValue('gap-test');
    jest.useFakeTimers();
    jest.setSystemTime(1);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it.each(['live', 'replay'] as const)('does not complete a real curl across 805ms → 30855ms in %s', async (executionMode) => {
    const onRepComplete = jest.fn();
    const extract = jest.spyOn(fqiCalculator, 'extractRepFeatures');
    const { result } = renderHook(() => useWorkoutController('dumbbell_curl', {
      sessionId: 'gap', executionMode, callbacks: { onRepComplete },
    }));
    await feed(result, curlFrames.slice(0, -1));
    expect(result.current.state.phase).toBe('lowering');
    expect(result.current.state.repCount).toBe(0);
    await feed(result, [[30855, 175]]);
    expect(result.current.state.repCount).toBe(0);
    expect(onRepComplete).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
    expect(logRep).not.toHaveBeenCalled();
    expect(hapticBus.emit).not.toHaveBeenCalled();
  });

  // Native subjectLockTimeout is 4s; expiry includes the exact boundary.
  it.each([3999, 4000, 4001])('applies the continuity cutoff at a %ims gap', async (gapMs) => {
    const { result } = renderHook(() => useWorkoutController('dumbbell_curl', {
      sessionId: 'boundary', executionMode: 'replay',
    }));
    await feed(result, curlFrames.slice(0, -1));
    await feed(result, [[805 + gapMs, 175]]);
    expect(result.current.state.repCount).toBe(gapMs < 4000 ? 1 : 0);
    expect(result.current.state.phase).toBe(gapMs < 4000 ? 'bottom' : 'setup');
  });

  it('requires a fresh phase hold after silence, including duplicate resumed timestamps', async () => {
    const onPhaseChange = jest.fn();
    const { result } = renderHook(() => useWorkoutController('dumbbell_curl', {
      sessionId: 'pending', executionMode: 'replay', callbacks: { onPhaseChange },
    }));
    await feed(result, [[1, 170]]); // pending bottom, no active rep yet
    const holdMs = computeAdaptivePhaseHoldMs({});
    await feed(result, [[4001, 170], [4001, 175], [4001 + holdMs - 1, 170]]);
    expect(result.current.state.phase).toBe('setup');
    expect(onPhaseChange).not.toHaveBeenCalled();
    await feed(result, [[4001 + holdMs, 170]]);
    expect(result.current.state.phase).toBe('bottom');
    expect(onPhaseChange.mock.calls).toEqual([['bottom', 'setup']]);
  });

  it.each(['live', 'replay'] as const)('requires a full clean rep after an interrupted curl in %s', async (executionMode) => {
    const onRepComplete = jest.fn();
    const extract = jest.spyOn(fqiCalculator, 'extractRepFeatures');
    const { result } = renderHook(() => useWorkoutController('dumbbell_curl', {
      sessionId: 'clean', executionMode, callbacks: { onRepComplete },
    }));
    await feed(result, curlFrames.slice(0, 6));
    const faulty = { ...angles(45), leftHip: 130, rightHip: 130 };
    jest.setSystemTime(154);
    await act(async () => result.current.processFrame(faulty, undefined, { timestampMs: 154 }));
    result.current.addRepCue('interrupted-cue');
    await feed(result, [[30154, 60], [30204, 110], [30254, 110], [30255, 170], [30305, 170]]);
    expect(result.current.state.phase).toBe('bottom');
    expect(result.current.state.repCount).toBe(0);
    expect(extract).not.toHaveBeenCalled();
    await feed(result, curlFrames.map(([time, elbow]) => [31000 + time, elbow] as const));
    expect(result.current.state.repCount).toBe(1);
    expect(onRepComplete).toHaveBeenCalledTimes(1);
    expect(onRepComplete.mock.calls[0][2]).not.toContain('swinging');
    expect(extract).toHaveBeenCalledWith(expect.objectContaining({
      min: expect.objectContaining({ leftHip: 175, rightHip: 175, leftElbow: 45 }),
    }), 753);
    if (executionMode === 'live') {
      expect(logRep).toHaveBeenCalledWith(expect.objectContaining({ cuesEmitted: [] }));
    }
  });

  it('preserves completed reps, adaptive history and pending writes across a gap', async () => {
    jest.mocked(logRep).mockRejectedValue(new Error('offline'));
    const onRepComplete = jest.fn();
    const onReset = jest.fn();
    const { result } = renderHook(() => useWorkoutController('dumbbell_curl', {
      sessionId: 'preserved', onReset, callbacks: { onRepComplete },
    }));
    await feed(result, curlFrames);
    expect(result.current.pendingRepCount).toBe(1);
    await feed(result, [[5000, 170]]);
    expect(result.current.state.repCount).toBe(1);
    expect(result.current.pendingRepCount).toBe(1);
    expect(result.current.getPendingRepCount()).toBe(1);
    expect(onReset).not.toHaveBeenCalled();
    // A 453ms second rep is accepted only with the first rep's adaptive history.
    jest.mocked(logRep).mockResolvedValue('recovered');
    await feed(result, curlFrames.map(([time, elbow]) => [
      5100 + time - (time >= 754 ? 300 : 0), elbow,
    ] as const));
    expect(result.current.state.repCount).toBe(2);
    expect(onRepComplete).toHaveBeenCalledTimes(2);
    expect(result.current.pendingRepCount).toBe(0);
    expect(jest.mocked(logRep).mock.calls.map(([event]) => event.repIndex)).toEqual([1, 1, 2]);
  });

  it('does not expire a slow rep while frames continue arriving', async () => {
    const { result } = renderHook(() => useWorkoutController('dumbbell_curl', {
      sessionId: 'slow', executionMode: 'replay',
    }));
    await feed(result, curlFrames.slice(0, 6));
    await feed(result, [[1153, 45], [2153, 45], [3153, 45], [4153, 45], [5153, 45]]);
    await feed(result, curlFrames.slice(6).map(([time, elbow]) => [time + 5000, elbow] as const));
    expect(result.current.state.repCount).toBe(1);
  });

  it('replays captured gaps and duplicate timestamps with identical phases, states and scoring', async () => {
    const recorder = new ExerciseRecorder('dumbbell_curl');
    const liveComplete = jest.fn();
    const livePhases = jest.fn();
    const onReset = jest.fn();
    const extract = jest.spyOn(fqiCalculator, 'extractRepFeatures');
    const live = renderHook(() => useWorkoutController('dumbbell_curl', {
      sessionId: 'live-capture', onFrame: (frame) => recorder.append(frame), onReset,
      callbacks: { onRepComplete: liveComplete, onPhaseChange: livePhases },
    }));
    const stream: Frame[] = [
      ...curlFrames, // completed rep survives
      ...curlFrames.slice(0, -1).map(([time, elbow]) => [time + 1000, elbow] as const),
      [31855, 175], [31855, 170], // expired unfinished rep, duplicate cannot establish hold
      ...curlFrames.map(([time, elbow]) => [time + 32000, elbow] as const),
    ];
    const liveStates = [];
    for (const frame of stream) {
      await feed(live.result, [frame]);
      liveStates.push(live.result.current.state);
      if (frame[0] === 31855) {
        expect(live.result.current.state.repCount).toBe(1);
        expect(live.result.current.state.phase).toBe('setup');
      }
    }
    expect(live.result.current.state.repCount).toBe(2);
    expect(onReset).not.toHaveBeenCalled();
    const liveFeatures = [...extract.mock.calls];
    const replayComplete = jest.fn();
    const replayPhases = jest.fn();
    const replay = renderHook(() => useWorkoutController('dumbbell_curl', {
      sessionId: 'replayed', executionMode: 'replay',
      callbacks: { onRepComplete: replayComplete, onPhaseChange: replayPhases },
    }));
    let driver!: ExerciseReplay;
    await act(async () => {
      driver = new ExerciseReplay(recorder.finish(), {
        reset: (id, options) => options ? replay.result.current.reset(options) : replay.result.current.setWorkout(id),
        processFrame: (a, j, c) => replay.result.current.processFrame(a, j, c),
      });
    });
    extract.mockClear();
    jest.mocked(logRep).mockClear();
    jest.mocked(hapticBus.emit).mockClear();
    for (const state of liveStates) {
      await act(async () => { expect(driver.step()).toBe(true); });
      expect(replay.result.current.state).toEqual(state);
    }
    expect(driver.step()).toBe(false);
    expect(replayPhases.mock.calls).toEqual(livePhases.mock.calls);
    expect(replayComplete.mock.calls).toEqual(liveComplete.mock.calls);
    expect(extract.mock.calls).toEqual(liveFeatures);
    expect(logRep).not.toHaveBeenCalled();
    expect(hapticBus.emit).not.toHaveBeenCalled();
  });
});
