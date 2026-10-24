import { act, renderHook } from '@testing-library/react-native';
import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import { useWorkoutController } from '@/features/form-tracking/hooks/use-workout-controller';
import * as fqiCalculator from '@/lib/services/fqi-calculator';
import { getWorkoutById } from '@/lib/workouts';
import { logRep } from '@/lib/services/rep-logger';
import { hapticBus } from '@/lib/haptics/haptic-bus';
import { ExerciseRecorder, ExerciseReplay } from '@/lib/debug/exercise-replay';

// Keep the real registry, FSM, adaptive timing, and FQI. Only isolate outputs.
jest.mock('@/lib/haptics/haptic-bus', () => ({ hapticBus: { emit: jest.fn() } }));
jest.mock('@/lib/services/rep-logger', () => ({ logRep: jest.fn().mockResolvedValue('replay-test') }));
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

// Same real curl stream as tracking-audit-regressions, with explicit frame times.
const curlFrames = [
  [1, 170], [51, 170], [52, 130], [102, 130], [103, 60],
  [153, 60], [754, 110], [804, 110], [805, 170], [855, 170],
] as const;

describe('workout controller timestamped replay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(logRep).mockResolvedValue('replay-test');
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('defaults to live and uses one wall-clock sample per frame for capture, timing, and telemetry', async () => {
    const onFrame = jest.fn();
    const onRepComplete = jest.fn();
    const { result } = renderHook(() => useWorkoutController('dumbbell_curl', {
      sessionId: 'live', onFrame, callbacks: { onRepComplete },
    }));
    const now = jest.spyOn(Date, 'now');
    const epoch = Date.parse('2026-01-01T00:00:00Z');
    for (const [timestampMs, elbow] of curlFrames) {
      jest.setSystemTime(epoch + timestampMs);
      await act(async () => {
        const callsBefore = now.mock.calls.length;
        result.current.processFrame(angles(elbow), undefined, { timestampMs: -1 });
        expect(now.mock.calls.length - callsBefore).toBe(1);
      });
    }
    expect(result.current.state.repCount).toBe(1);
    expect(logRep).toHaveBeenCalledWith(expect.objectContaining({
      startTs: new Date(epoch + 102).toISOString(), endTs: new Date(epoch + 855).toISOString(),
      features: expect.objectContaining({ durationMs: 753 }), fqi: 95,
    }));
    expect(hapticBus.emit).toHaveBeenCalledWith('rep.complete');
    const recorded = onFrame.mock.calls.map(([frame]) => frame);
    const replayComplete = jest.fn();
    const replay = renderHook(() => useWorkoutController('dumbbell_curl', {
      sessionId: 'replay', executionMode: 'replay', callbacks: { onRepComplete: replayComplete },
    }));
    now.mockClear();
    for (const frame of recorded) {
      await act(async () => replay.result.current.processFrame(frame.angles, undefined, {
        ...frame.context, timestampMs: frame.timestampMs,
      }));
    }
    expect(now).not.toHaveBeenCalled();
    expect(replay.result.current.state).toEqual(result.current.state);
    expect(replayComplete.mock.calls).toEqual(onRepComplete.mock.calls);
  });

  it('replays captured same-millisecond live frames with identical phases, rep features and FQI', async () => {
    const recorder = new ExerciseRecorder('dumbbell_curl');
    const liveComplete = jest.fn();
    const livePhases = jest.fn();
    const features = jest.spyOn(fqiCalculator, 'extractRepFeatures');
    const live = renderHook(() => useWorkoutController('dumbbell_curl', {
      sessionId: 'live-duplicates', onFrame: (frame) => recorder.append(frame),
      callbacks: { onRepComplete: liveComplete, onPhaseChange: livePhases },
    }));
    // The second input at 153ms changes the rep's minimum angle, so losing
    // it or reordering it is observable in the production scoring inputs.
    const frames = [...curlFrames.slice(0, 6), [153, 50], ...curlFrames.slice(6)] as const;
    const epoch = Date.now();
    const liveStates = [];
    for (const [time, elbow] of frames) {
      jest.setSystemTime(epoch + time);
      await act(async () => live.result.current.processFrame(angles(elbow)));
      liveStates.push(live.result.current.state);
    }
    expect(live.result.current.state.repCount).toBe(1);
    expect(liveComplete).toHaveBeenCalledTimes(1);
    const captured = recorder.finish();
    expect(captured.frames.map((frame) => frame.timestampMs - epoch)).toEqual(frames.map(([time]) => time));
    const liveFeatures = [...features.mock.calls];
    expect(liveFeatures[0][0].min.leftElbow).toBe(50);
    const replayComplete = jest.fn();
    const replayPhases = jest.fn();
    const replay = renderHook(() => useWorkoutController('dumbbell_curl', {
      sessionId: 'replay-duplicates', executionMode: 'replay',
      callbacks: { onRepComplete: replayComplete, onPhaseChange: replayPhases },
    }));
    let driver!: ExerciseReplay;
    await act(async () => {
      driver = new ExerciseReplay(captured, {
        reset: (id, options) => options ? replay.result.current.reset(options) : replay.result.current.setWorkout(id),
        processFrame: (a, j, c) => replay.result.current.processFrame(a, j, c),
      });
    });
    features.mockClear();
    jest.mocked(logRep).mockClear();
    jest.mocked(hapticBus.emit).mockClear();
    for (let index = 0; index < frames.length; index++) {
      await act(async () => { expect(driver.step()).toBe(true); });
      expect(replay.result.current.state).toEqual(liveStates[index]);
    }
    expect(driver.step()).toBe(false);
    expect(replayPhases.mock.calls).toEqual(livePhases.mock.calls);
    expect(replayComplete.mock.calls).toEqual(liveComplete.mock.calls);
    expect(features.mock.calls).toEqual(liveFeatures);
    expect(logRep).not.toHaveBeenCalled();
    expect(hapticBus.emit).not.toHaveBeenCalled();
  });

  it('reports explicit live resets in frame order, using the latest callback and normalized options', async () => {
    const events: unknown[] = [];
    const onReset = jest.fn((options) => events.push(['reset', options]));
    const replacement = jest.fn((options) => events.push(['latest-reset', options]));
    const { result, rerender } = renderHook(
      ({ notify, pauseTracking }: {
        notify: (options: { preserveRepCount?: boolean }) => void;
        pauseTracking: boolean;
      }) => useWorkoutController('dumbbell_curl', {
        sessionId: 'live', onReset: notify, pauseTracking,
        onFrame: (frame) => events.push(['frame', frame.timestampMs]),
      }),
      { initialProps: { notify: onReset, pauseTracking: false } },
    );
    expect(onReset).not.toHaveBeenCalled();
    await act(async () => result.current.setWorkout('dumbbell_curl'));
    expect(onReset).not.toHaveBeenCalled();
    const now = Date.now();
    await act(async () => {
      result.current.processFrame(angles(170));
      result.current.reset({ preserveRepCount: true });
      result.current.processFrame(angles(130));
    });
    rerender({ notify: replacement, pauseTracking: true });
    await act(async () => {
      result.current.reset();
      result.current.processFrame(angles(170)); // paused input is not recorded
    });
    expect(events).toEqual([
      ['frame', now], ['reset', { preserveRepCount: true }], ['frame', now],
      ['latest-reset', { preserveRepCount: false }],
    ]);
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(replacement).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ phase: 'setup', repCount: 0, metrics: null, isActive: false });
  });

  it('never reports reset capture events from a replay controller', async () => {
    const onReset = jest.fn();
    const { result } = renderHook(() => useWorkoutController('dumbbell_curl', {
      sessionId: 'replay', executionMode: 'replay', onReset,
    }));
    await act(async () => {
      result.current.reset();
      result.current.reset({ preserveRepCount: true });
      result.current.setWorkout('squat');
    });
    expect(onReset).not.toHaveBeenCalled();
  });

  it('timestamps replay cues with the latest accepted frame, not the wall clock', async () => {
    const { result, rerender } = renderHook(({ pauseTracking }: { pauseTracking: boolean }) => useWorkoutController('dumbbell_curl', {
      sessionId: 'replay', executionMode: 'replay', pauseTracking,
    }), { initialProps: { pauseTracking: false } });
    for (const [timestampMs, elbow] of curlFrames.slice(0, 5)) {
      await act(async () => result.current.processFrame(angles(elbow), undefined, { timestampMs }));
    }
    rerender({ pauseTracking: true });
    await act(async () => result.current.processFrame(angles(170), undefined, { timestampMs: 999 }));
    const iso = jest.spyOn(Date.prototype, 'toISOString');
    result.current.addRepCue('slow-down');
    expect(iso).toHaveBeenCalledTimes(1);
    expect(iso.mock.contexts[0].getTime()).toBe(103);
  });

  it('captures independent live inputs using wall time, excluding paused and replay frames', async () => {
    const onFrame = jest.fn();
    const { result, rerender } = renderHook(
      ({ pauseTracking, executionMode }: { pauseTracking: boolean; executionMode: 'live' | 'replay' }) =>
        useWorkoutController('dumbbell_curl', { sessionId: 'capture', onFrame, pauseTracking, executionMode }),
      { initialProps: { pauseTracking: false, executionMode: 'live' as 'live' | 'replay' } },
    );
    const input = angles(170);
    const joint = { x: 0.2, y: 0.4, isTracked: true, confidence: 0.9 };
    const joints = new Map([['left_elbow', joint]]);
    const context = { timestampMs: NaN, trackingQuality: 0.9, shadowMeanAbsDelta: 2 };
    const wallTime = Date.now();
    await act(async () => result.current.processFrame(input, joints, context));
    expect(onFrame).toHaveBeenCalledWith({
      timestampMs: wallTime, angles: angles(170), joints: { left_elbow: joint },
      context: { trackingQuality: 0.9, shadowMeanAbsDelta: 2 },
    });
    input.leftElbow = 1;
    joint.x = 100;
    joints.clear();
    context.trackingQuality = 0;
    const captured = onFrame.mock.calls[0][0];
    expect(captured.angles.leftElbow).toBe(170);
    expect(captured.joints.left_elbow.x).toBe(0.2);
    expect(captured.context.trackingQuality).toBe(0.9);
    rerender({ pauseTracking: true, executionMode: 'live' });
    await act(async () => result.current.processFrame(angles(170)));
    rerender({ pauseTracking: false, executionMode: 'replay' });
    await act(async () => result.current.processFrame(angles(170), undefined, { timestampMs: 1 }));
    expect(onFrame).toHaveBeenCalledTimes(1);
  });

  it('keeps adaptive rep history and callbacks without persistence, retries, or haptics', async () => {
    const onRepComplete = jest.fn();
    const onRepLogFailure = jest.fn();
    jest.mocked(logRep).mockRejectedValue(new Error('must never write a replay'));
    const { result } = renderHook(() => useWorkoutController('dumbbell_curl', {
      sessionId: 'replay', executionMode: 'replay', enableHaptics: true,
      callbacks: { onRepComplete, onRepLogFailure },
    }));
    for (const [timestampMs, elbow] of curlFrames) {
      await act(async () => result.current.processFrame(angles(elbow), undefined, { timestampMs }));
    }
    // Second rep lasts 453ms: valid only if the first rep's adaptive history survived.
    for (const [time, elbow] of curlFrames.slice(2)) {
      const timestampMs = 1000 + time - (time >= 754 ? 300 : 0);
      await act(async () => result.current.processFrame(angles(elbow), undefined, { timestampMs }));
    }
    expect(result.current.state.repCount).toBe(2);
    expect(onRepComplete).toHaveBeenCalledTimes(2);
    expect(logRep).not.toHaveBeenCalled();
    expect(hapticBus.emit).not.toHaveBeenCalled();
    expect(result.current.pendingRepCount).toBe(0);
    expect(result.current.getPendingRepCount()).toBe(0);
    expect(result.current.flushPendingRepsOnStop()).toBe(0);
    expect(onRepLogFailure).not.toHaveBeenCalled();
  });

  it.each([undefined, NaN, Infinity, -Infinity, 0, -1, 99])(
    'rejects invalid or backwards replay timestamp %s without consuming a frame',
    async (timestampMs) => {
      const { result } = renderHook(() => useWorkoutController('dumbbell_curl', {
        sessionId: 'replay', executionMode: 'replay',
      }));
      await act(async () => result.current.processFrame(angles(170), undefined, { timestampMs: 100 }));
      expect(() => result.current.processFrame(angles(60), undefined, { timestampMs })).toThrow(/timestampMs/);
      await act(async () => result.current.processFrame(angles(170), undefined, { timestampMs: 150 }));
      expect(result.current.state.phase).toBe('bottom');
      await act(async () => result.current.reset());
      expect(() => result.current.processFrame(angles(170), undefined, { timestampMs: 1 })).not.toThrow();
    },
  );

  it('repeats the real curl phases and FQI after reset regardless of wall time', async () => {
    const calculate = jest.spyOn(fqiCalculator, 'calculateFqi');
    const features = jest.spyOn(fqiCalculator, 'extractRepFeatures');
    const onRepComplete = jest.fn();
    const onPhaseChange = jest.fn();
    const { result } = renderHook(() => useWorkoutController('dumbbell_curl', {
      sessionId: 'replay', executionMode: 'replay', enableHaptics: false,
      callbacks: { onRepComplete, onPhaseChange },
    }));
    const run = async () => {
      for (const [timestampMs, elbow] of curlFrames) {
        await act(async () => result.current.processFrame(angles(elbow), undefined, { timestampMs }));
      }
      return { state: result.current.state, phases: [...onPhaseChange.mock.calls], reps: [...onRepComplete.mock.calls] };
    };
    const first = await run();
    expect(first.state.repCount).toBe(1);
    expect(first.phases).toEqual([
      ['bottom', 'setup'], ['curling', 'bottom'], ['top', 'curling'],
      ['lowering', 'top'], ['bottom', 'lowering'],
    ]);
    expect(calculate).toHaveBeenCalledWith(expect.any(Object), 753, 1, getWorkoutById('dumbbell_curl'));
    expect(features).toHaveBeenCalledWith(expect.any(Object), 753);
    expect(first.reps).toEqual([[1, calculate.mock.results[0].value.score, calculate.mock.results[0].value.detectedFaults]]);
    expect(calculate.mock.results[0].value.score).toBeGreaterThan(0);
    await act(async () => result.current.reset());
    onRepComplete.mockClear();
    onPhaseChange.mockClear();
    jest.setSystemTime(new Date('2030-06-01T00:00:00Z'));
    expect(await run()).toEqual(first);
  });
});
