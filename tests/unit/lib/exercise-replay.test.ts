import { ExerciseRecorder, ExerciseReplay, MAX_REPLAY_FRAMES, parseExerciseRecording } from '@/lib/debug/exercise-replay';

const angles = {
  leftElbow: 170, rightElbow: 170, leftShoulder: 90, rightShoulder: 90,
  leftHip: 175, rightHip: 175, leftKnee: 175, rightKnee: 175,
};
function recording() {
  return {
    version: 1, source: 'recorded', stage: 'controller-input', workoutId: 'dumbbell_curl',
    frames: [{ timestampMs: 100, angles }, { timestampMs: 150, angles }],
  };
}

describe('deterministic playback', () => {
  it('preserves controller resets between frames and after the last frame on every run', () => {
    const recorder = new ExerciseRecorder('dumbbell_curl');
    recorder.append({ timestampMs: 100, angles });
    recorder.reset({ preserveRepCount: true });
    recorder.append({ timestampMs: 150, angles });
    recorder.reset({ preserveRepCount: false });
    const events: unknown[] = [];
    const replay = new ExerciseReplay(recorder.finish(), {
      reset: (_id, options) => { events.push(options ?? 'start'); },
      processFrame: () => { events.push('frame'); },
    });
    replay.run();
    expect(events).toEqual(['start', 'frame', { preserveRepCount: true }, 'frame', { preserveRepCount: false }]);
    expect(replay.step()).toBe(false);
    expect(events).toHaveLength(5);
    events.length = 0;
    replay.restart();
    replay.run();
    expect(events).toEqual(['start', 'frame', { preserveRepCount: true }, 'frame', { preserveRepCount: false }]);
  });

  it('combines consecutive resets without restoring an already cleared rep count', () => {
    const recorder = new ExerciseRecorder('dumbbell_curl');
    recorder.append({ timestampMs: 0, angles });
    recorder.reset({ preserveRepCount: false });
    recorder.reset({ preserveRepCount: true });
    expect(recorder.finish().resets).toEqual([{ beforeFrame: 1, preserveRepCount: false }]);
  });

  it('steps each frame once using recorded intervals and preserves missing context', () => {
    const target = { reset: jest.fn(), processFrame: jest.fn() };
    const replay = new ExerciseReplay(parseExerciseRecording(recording()), target);
    expect(target.reset).toHaveBeenCalledWith('dumbbell_curl');
    expect(replay.position).toBe(0);
    expect(replay.step()).toBe(true);
    expect(replay.position).toBe(1);
    expect(replay.step()).toBe(true);
    expect(replay.step()).toBe(false);
    expect(target.processFrame).toHaveBeenCalledTimes(2);
    const first = target.processFrame.mock.calls[0][2];
    const second = target.processFrame.mock.calls[1][2];
    expect(second.timestampMs - first.timestampMs).toBe(50);
    expect(first.timestampMs).toBeGreaterThan(0);
    expect(first.trackingQuality).toBeUndefined();
  });

  it('retains equal zero-based timestamps and their order when rebasing to a positive replay clock', () => {
    const recorder = new ExerciseRecorder('dumbbell_curl');
    recorder.append({ timestampMs: 0, angles });
    recorder.append({ timestampMs: 0, angles: { ...angles, leftElbow: 160 } });
    recorder.append({ timestampMs: 50, angles });
    const captured = recorder.finish();
    expect(captured.frames.map((frame) => frame.timestampMs)).toEqual([0, 0, 50]);
    const processFrame = jest.fn();
    new ExerciseReplay(captured, { reset: jest.fn(), processFrame }).run();
    const times = processFrame.mock.calls.map(([, , context]) => context.timestampMs);
    expect(times[0]).toBeGreaterThan(0);
    expect(times.map((time) => time - times[0])).toEqual([0, 0, 50]);
    expect(processFrame.mock.calls.map(([frameAngles]) => frameAngles.leftElbow)).toEqual([170, 160, 170]);
  });

  it('rebuilds history on seek and restart, then runs the rest without waiting for real time', () => {
    const seen: number[] = [];
    const target = {
      reset: jest.fn(() => { seen.length = 0; }),
      processFrame: jest.fn((_angles, _joints, context) => { seen.push(context.timestampMs); }),
    };
    const replay = new ExerciseReplay(parseExerciseRecording(recording()), target);
    replay.run();
    const full = [...seen];
    replay.seek(1);
    expect(seen).toEqual(full.slice(0, 1));
    expect(replay.position).toBe(1);
    replay.run();
    expect(seen).toEqual(full);
    replay.restart();
    expect(replay.position).toBe(0);
    expect(seen).toEqual([]);
    replay.run();
    expect(seen).toEqual(full);
    for (const invalid of [-1, 0.5, 3, NaN]) expect(() => replay.seek(invalid)).toThrow();
    expect(seen).toEqual(full);
  });

  it('snapshots the recording and protects restarts from target mutations', () => {
    const input = parseExerciseRecording({ ...recording(), frames: [{
      timestampMs: 0, angles,
      joints: { elbow: { x: 0.1, y: 0.2, isTracked: false, confidence: 0.1 } },
      context: { trackingQuality: 0.2 },
    }] });
    const seen: unknown[] = [];
    const replay = new ExerciseReplay(input, {
      reset: () => {}, processFrame: (a, j, c) => {
        seen.push([a.leftElbow, j?.get('elbow')?.confidence, c.trackingQuality]);
        a.leftElbow = 4;
        j!.get('elbow')!.confidence = 1;
      },
    });
    input.frames[0].angles.leftElbow = 2;
    replay.run();
    replay.restart();
    replay.run();
    expect(seen).toEqual([[170, 0.1, 0.2], [170, 0.1, 0.2]]);
  });
});

describe('capture once', () => {
  it('copies each accepted input and exports a recorded trace with no machine-generated truth label', () => {
    const recorder = new ExerciseRecorder('squat');
    const frame = { timestampMs: 100, angles: { ...angles } };
    recorder.append(frame);
    frame.angles.leftElbow = 20;
    recorder.append({ ...frame, timestampMs: 150 });
    const result = recorder.finish();
    expect(result.source).toBe('recorded');
    expect(result.workoutId).toBe('squat');
    expect(result.frames[0].angles.leftElbow).toBe(170);
    expect(result.frames[1].angles.leftElbow).toBe(20);
    result.frames[0].angles.leftElbow = 1;
    expect(recorder.finish().frames[0].angles.leftElbow).toBe(170);
    expect(result.expectedRepCount).toBeUndefined();
  });

  it.each([NaN, Infinity, -Infinity, 99])('rejects invalid time %s after duplicate frames without losing them', (timestampMs) => {
    const recorder = new ExerciseRecorder('squat');
    recorder.append({ timestampMs: 100, angles });
    recorder.append({ timestampMs: 100, angles: { ...angles, leftElbow: 160 } });
    expect(() => recorder.append({ timestampMs, angles })).toThrow(/timestampMs/);
    recorder.append({ timestampMs: 150, angles });
    expect(recorder.finish().frames.map((frame) => [frame.timestampMs, frame.angles.leftElbow]))
      .toEqual([[100, 170], [100, 160], [150, 170]]);
  });

  it('fails explicitly on empty, bad chronology and over-limit captures', () => {
    const recorder = new ExerciseRecorder('squat');
    expect(() => recorder.finish()).toThrow();
    recorder.append({ timestampMs: 1, angles });
    expect(() => recorder.append({ timestampMs: 0, angles })).toThrow(/nondecreasing/);
    for (let i = 1; i < MAX_REPLAY_FRAMES; i++) recorder.append({ timestampMs: i, angles });
    expect(() => recorder.append({ timestampMs: MAX_REPLAY_FRAMES, angles })).toThrow(/limit/i);
    expect(recorder.finish().frames).toHaveLength(MAX_REPLAY_FRAMES);
  });
});

describe('exercise recording validation', () => {
  it('accepts a versioned recording without treating the recorded rep count as ground truth', () => {
    const input = recording();
    const parsed = parseExerciseRecording(input);
    expect(parsed).toEqual(input);
    expect(parsed.expectedRepCount).toBeUndefined();
    expect(parsed.frames[0].angles).not.toBe(input.frames[0].angles);
  });

  it.each([
    ['empty frames', { frames: [] }],
    ['unknown exercise', { workoutId: 'constructor' }],
    ['wrong version', { version: 2 }],
    ['missing provenance', { source: undefined }],
    ['raw input stage', { stage: 'raw-pose' }],
    ['NaN time', { frames: [{ timestampMs: NaN, angles }] }],
    ['infinite time', { frames: [{ timestampMs: Infinity, angles }] }],
    ['unsafe time', { frames: [{ timestampMs: Number.MAX_SAFE_INTEGER + 1, angles }] }],
    ['backwards time', { frames: [{ timestampMs: 100, angles }, { timestampMs: 50, angles }] }],
    ['negative time', { frames: [{ timestampMs: -1, angles }] }],
    ['missing angle', { frames: [{ timestampMs: 0, angles: { ...angles, leftElbow: undefined } }] }],
    ['NaN angle', { frames: [{ timestampMs: 0, angles: { ...angles, leftElbow: NaN } }] }],
    ['invalid confidence', { frames: [{ timestampMs: 0, angles, joints: { elbow: { x: 0, y: 0, isTracked: true, confidence: 2 } } }] }],
    ['invalid quality', { frames: [{ timestampMs: 0, angles, context: { trackingQuality: -1 } }] }],
    ['fractional expected reps', { expectedRepCount: 1.5 }],
  ])('rejects %s rather than silently repairing a trace', (_name, invalid) => {
    expect(() => parseExerciseRecording({ ...recording(), ...invalid })).toThrow();
  });

  it('preserves confidence, quality, missing joints and human labels without inventing inputs', () => {
    const frame = {
      timestampMs: 0, angles,
      joints: { elbow: { x: 0.3, y: 0.4, isTracked: false, confidence: 0.1 } },
      context: { trackingQuality: 0.25, shadowMeanAbsDelta: null },
    };
    const input = { ...recording(), frames: [frame], expectedRepCount: 0 };
    const output = parseExerciseRecording(input);
    expect(output).toEqual(input);
    expect(output.frames[0].joints?.elbow).not.toBe(frame.joints.elbow);
  });
});
