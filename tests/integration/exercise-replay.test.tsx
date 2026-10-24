import { readFileSync, writeFileSync } from 'node:fs';
import { act, renderHook } from '@testing-library/react-native';
import { useWorkoutController } from '@/features/form-tracking/hooks/use-workout-controller';
import { ExerciseReplay, parseExerciseRecording } from '@/lib/debug/exercise-replay';
import { logRep } from '@/lib/services/rep-logger';
import * as FileSystem from 'expo-file-system/legacy';
import { ExerciseRecordingStore } from '@/lib/debug/exercise-recording-store';
import * as fqiCalculator from '@/lib/services/fqi-calculator';
import { hapticBus } from '@/lib/haptics/haptic-bus';
import syntheticCurl from '../fixtures/exercise-replay/synthetic-curl.json';

// Only output side effects are mocked. Registry, FSM, timing and FQI are real.
jest.mock('@/lib/services/rep-logger', () => ({ logRep: jest.fn().mockResolvedValue('unexpected-write') }));
jest.mock('@/lib/haptics/haptic-bus', () => ({ hapticBus: { emit: jest.fn() } }));
jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(), warnWithTs: jest.fn(), errorWithTs: jest.fn(), infoWithTs: jest.fn(),
}));

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  moveAsync: jest.fn().mockResolvedValue(undefined),
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true }),
  readAsStringAsync: jest.fn(),
}));

beforeEach(() => jest.clearAllMocks());
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test.each([false, true])('captures and replays live frames (interrupted rep=%s; otherwise same-ms frames) without phantom reps', async (interrupted) => {
  jest.useFakeTimers();
  const epoch = Date.parse('2026-01-01T00:00:00Z');
  const store = new ExerciseRecordingStore();
  store.arm();
  expect(store.begin('dumbbell_curl', false)).toBe(true);
  const calculate = jest.spyOn(fqiCalculator, 'calculateFqi');
  const onRepComplete = jest.fn();
  const live = renderHook(() => useWorkoutController('dumbbell_curl', {
    sessionId: 'live-capture', onFrame: (frame) => store.append(frame), callbacks: { onRepComplete },
    onReset: (options) => store.reset(options),
  }));
  const curlFrames = [
    ...syntheticCurl.frames.slice(0, 5),
    { ...syntheticCurl.frames[4], angles: { ...syntheticCurl.frames[4].angles, leftElbow: 50 } },
    ...syntheticCurl.frames.slice(5),
  ];
  const frames = interrupted ? [
    ...syntheticCurl.frames,
    ...syntheticCurl.frames.map((frame) => ({ ...frame, timestampMs: frame.timestampMs + 2000 })),
  ] : curlFrames;
  const resetBeforeFrame = syntheticCurl.frames.length + 5;
  const liveStates = [];
  for (const frame of frames) {
    // Lose pose in the active curl, then resume its remaining frames rather
    // than starting another full rep. Replay must not complete a phantom rep.
    if (interrupted && liveStates.length === resetBeforeFrame) {
      expect(live.result.current.state.phase).toBe('curling');
      await act(async () => live.result.current.reset({ preserveRepCount: true }));
    }
    jest.setSystemTime(epoch + frame.timestampMs);
    await act(async () => live.result.current.processFrame(frame.angles));
    liveStates.push(live.result.current.state);
  }
  expect(live.result.current.state.repCount).toBe(1);
  expect(store.status).toBe('recording');
  expect(store.lastError).toBeNull();
  await store.finish();
  expect(FileSystem.writeAsStringAsync).toHaveBeenCalledTimes(1);
  const serialized = jest.mocked(FileSystem.writeAsStringAsync).mock.calls[0][1];
  jest.mocked(FileSystem.readAsStringAsync).mockResolvedValueOnce(serialized);
  const recording = (await store.loadLatest())!;
  expect(recording.resets).toEqual(interrupted ? [{ beforeFrame: resetBeforeFrame, preserveRepCount: true }] : undefined);
  expect(recording.frames.map((frame) => frame.timestampMs)).toEqual(frames.map((frame) => epoch + frame.timestampMs));
  expect(recording.frames.map((frame) => frame.angles)).toEqual(frames.map((frame) => frame.angles));
  const liveScoring = [...calculate.mock.calls];
  const liveReps = [...onRepComplete.mock.calls];
  calculate.mockClear();
  onRepComplete.mockClear();
  jest.mocked(logRep).mockClear();
  jest.mocked(hapticBus.emit).mockClear();
  const replayHook = renderHook(() => useWorkoutController('dumbbell_curl', {
    sessionId: 'replay', executionMode: 'replay', callbacks: { onRepComplete },
  }));
  const times: number[] = [];
  let replay!: ExerciseReplay;
  await act(async () => {
    replay = new ExerciseReplay(recording, {
      reset: (id, options) => options ? replayHook.result.current.reset(options) : replayHook.result.current.setWorkout(id),
      processFrame: (angles, joints, context) => {
        times.push(context.timestampMs);
        replayHook.result.current.processFrame(angles, joints, context);
      },
    });
  });
  for (const state of liveStates) {
    await act(async () => { expect(replay.step()).toBe(true); });
    expect(replayHook.result.current.state).toEqual(state);
  }
  expect(replay.step()).toBe(false);
  expect(times.every((time) => time > 0)).toBe(true);
  expect(times.map((time) => time - times[0])).toEqual(frames.map((frame) => frame.timestampMs));
  expect(calculate.mock.calls).toEqual(liveScoring);
  expect(onRepComplete.mock.calls).toEqual(liveReps);
  if (interrupted) {
    // Negative control: dropping the captured pose-loss reset really does
    // invent a second rep from the interrupted curl's remaining frames.
    await act(async () => {
      new ExerciseReplay({ ...recording, resets: undefined }, {
        reset: (id) => replayHook.result.current.setWorkout(id),
        processFrame: (...args) => replayHook.result.current.processFrame(...args),
      }).run();
    });
    expect(replayHook.result.current.state.repCount).toBe(2);
  }
  expect(logRep).not.toHaveBeenCalled();
  expect(hapticBus.emit).not.toHaveBeenCalled();
});

test.each([true, false])('replays a captured mid-rep reset with preserveRepCount=%s identically', async (preserveRepCount) => {
  jest.useFakeTimers();
  const epoch = Date.parse('2026-01-01T00:00:00Z');
  const store = new ExerciseRecordingStore();
  store.arm();
  store.begin('dumbbell_curl', false);
  const onRepComplete = jest.fn();
  const onPhaseChange = jest.fn();
  const live = renderHook(() => useWorkoutController('dumbbell_curl', {
    sessionId: 'live-reset', callbacks: { onRepComplete, onPhaseChange },
    onFrame: (frame) => store.append(frame), onReset: (options) => store.reset(options),
  }));
  const input = parseExerciseRecording(syntheticCurl);
  const feed = async (offset: number, frames = input.frames) => {
    for (const frame of frames) {
      jest.setSystemTime(epoch + offset + frame.timestampMs);
      await act(async () => live.result.current.processFrame(frame.angles));
    }
  };
  await feed(0);
  expect(live.result.current.state.repCount).toBe(1);
  await feed(2000, input.frames.slice(0, 5));
  expect(live.result.current.state.phase).toBe('curling');
  await act(async () => live.result.current.reset({ preserveRepCount }));
  expect(live.result.current.state).toEqual({
    phase: 'setup', repCount: preserveRepCount ? 1 : 0, metrics: null, isActive: false,
  });
  await feed(4000);
  expect(live.result.current.state.repCount).toBe(preserveRepCount ? 2 : 1);
  const expected = {
    state: live.result.current.state, reps: [...onRepComplete.mock.calls], phases: [...onPhaseChange.mock.calls],
  };
  await store.finish();
  const serialized = jest.mocked(FileSystem.writeAsStringAsync).mock.calls[0][1];
  jest.mocked(FileSystem.readAsStringAsync).mockResolvedValueOnce(serialized);
  const recording = (await store.loadLatest())!;
  expect(recording.resets).toEqual([{ beforeFrame: 15, preserveRepCount }]);
  onRepComplete.mockClear();
  onPhaseChange.mockClear();
  jest.mocked(logRep).mockClear();
  jest.mocked(hapticBus.emit).mockClear();
  const onReset = jest.fn();
  const replayHook = renderHook(() => useWorkoutController('dumbbell_curl', {
    sessionId: 'replay-reset', executionMode: 'replay', onReset, callbacks: { onRepComplete, onPhaseChange },
  }));
  let replay!: ExerciseReplay;
  await act(async () => {
    replay = new ExerciseReplay(recording, {
      reset: (id, options) => options ? replayHook.result.current.reset(options) : replayHook.result.current.setWorkout(id),
      processFrame: (...args) => replayHook.result.current.processFrame(...args),
    });
    replay.run();
  });
  expect({ state: replayHook.result.current.state, reps: onRepComplete.mock.calls, phases: onPhaseChange.mock.calls }).toEqual(expected);
  await act(async () => replay.restart());
  onRepComplete.mockClear();
  onPhaseChange.mockClear();
  for (let index = 0; index < recording.frames.length; index++) await act(async () => { replay.step(); });
  expect({ state: replayHook.result.current.state, reps: onRepComplete.mock.calls, phases: onPhaseChange.mock.calls }).toEqual(expected);
  expect(onReset).not.toHaveBeenCalled();
  expect(logRep).not.toHaveBeenCalled();
  expect(hapticBus.emit).not.toHaveBeenCalled();
});

test('replays through the production controller identically after restart, with no saved workout', async () => {
  const recording = parseExerciseRecording(process.env.FF_REPLAY_FILE
    ? JSON.parse(readFileSync(process.env.FF_REPLAY_FILE, 'utf8')) : syntheticCurl);
  const reps: { rep: number; fqi: number; faults: string[] }[] = [];
  const phases: string[] = [];
  const callbacks = {
    onRepComplete: (rep: number, fqi: number, faults: string[]) => { reps.push({ rep, fqi, faults }); },
    onPhaseChange: (phase: string) => { phases.push(phase); },
  };
  const hook = renderHook(() => useWorkoutController(recording.workoutId, {
    sessionId: 'isolated-replay', executionMode: 'replay', enableHaptics: true, callbacks,
  }));
  let replay!: ExerciseReplay;
  await act(async () => {
    replay = new ExerciseReplay(recording, {
      reset: (workoutId, options) => {
        if (options) hook.result.current.reset(options);
        else { reps.length = 0; phases.length = 0; hook.result.current.setWorkout(workoutId); }
      },
      processFrame: (...args) => hook.result.current.processFrame(...args),
    });
    replay.run();
  });
  const first = { repCount: hook.result.current.state.repCount, phase: hook.result.current.state.phase, reps: [...reps], phases: [...phases] };
  await act(async () => { replay.restart(); });
  // Step individually, with React renders between frames, instead of one batch.
  for (let i = 0; i < recording.frames.length; i++) await act(async () => { replay.step(); });
  expect({ repCount: hook.result.current.state.repCount, phase: hook.result.current.state.phase, reps, phases }).toEqual(first);
  expect(logRep).not.toHaveBeenCalled();
  expect(hapticBus.emit).not.toHaveBeenCalled();
  expect(hook.result.current.pendingRepCount).toBe(0);
  for (const rep of reps) {
    expect(Number.isFinite(rep.fqi)).toBe(true);
    expect(rep.fqi).toBeGreaterThanOrEqual(0);
    expect(rep.fqi).toBeLessThanOrEqual(100);
  }
  if (recording.expectedRepCount !== undefined) expect(first.repCount).toBe(recording.expectedRepCount);
  hook.unmount();
  const report = {
    source: recording.source, stage: recording.stage, workoutId: recording.workoutId,
    frames: recording.frames.length,
    durationMs: recording.frames[recording.frames.length - 1].timestampMs - recording.frames[0].timestampMs,
    deterministic: true, persistedReps: 0,
    accuracy: recording.expectedRepCount === undefined ? 'unlabelled: NOT validated' : 'matches supplied rep-count label',
    expectedRepCount: recording.expectedRepCount ?? null,
    ...first,
  };
  if (process.env.FF_REPLAY_REPORT) writeFileSync(process.env.FF_REPLAY_REPORT, JSON.stringify(report, null, 2) + '\n');
  if (process.env.FF_REPLAY_FILE) console.log('Exercise replay report:', JSON.stringify(report, null, 2));
});
