import * as FileSystem from 'expo-file-system/legacy';
import { readFileSync } from 'fs';
import path from 'path';
import ts from 'typescript';
import { ExerciseRecordingStore } from '@/lib/debug/exercise-recording-store';
import { readScanScreenSource } from '../../helpers/scan-screen-source';

// Execute only trusted repository source (never user/external strings).
// Exercise the actual Scan observer and controller option without mounting native UI.
function scanResetObserver(store: ExerciseRecordingStore, development: boolean, fixture: boolean) {
  const filename = path.resolve(process.cwd(), 'app/(tabs)/scan-arkit.tsx');
  const source = ts.createSourceFile(filename, readScanScreenSource(), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const screen = source.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'ScanARKitScreen');
  const declarations = screen!.body!.statements.filter(ts.isVariableStatement)
    .flatMap(node => [...node.declarationList.declarations]);
  const observer = declarations.find(node => node.name.getText(source) === 'onExerciseRecordingReset');
  const controller = declarations.find(node => node.name.getText(source) === 'workoutController')!.initializer as ts.CallExpression;
  const options = controller.arguments[1] as ts.ObjectLiteralExpression;
  const binding = options.properties.find((node): node is ts.PropertyAssignment =>
    ts.isPropertyAssignment(node) && node.name.getText(source) === 'onReset');
  expect(observer).toBeDefined();
  expect(binding).toBeDefined();
  const js = ts.transpileModule(`const ${observer!.getText(source)}; return ${binding!.initializer.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  // No workout/native state or setters are exposed to this capture-only callback.
  return new Function('useCallback', 'exerciseRecordingStore', '__DEV__', 'fixturePlaybackEnabled', js)(
    (callback: unknown) => callback, store, development, fixture,
  ) as ((options?: { preserveRepCount?: boolean }) => void) | undefined;
}

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  moveAsync: jest.fn().mockResolvedValue(undefined),
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true }),
  readAsStringAsync: jest.fn(),
}));

const frame = (timestampMs: number) => ({ timestampMs, angles: {
  leftElbow: 170, rightElbow: 170, leftShoulder: 170, rightShoulder: 170,
  leftKnee: 175, rightKnee: 175, leftHip: 175, rightHip: 175,
} });

beforeEach(() => {
  jest.clearAllMocks();
  (FileSystem.writeAsStringAsync as jest.Mock).mockResolvedValue(undefined);
  (FileSystem.moveAsync as jest.Mock).mockResolvedValue(undefined);
});

it('abandons invalid or empty captures without throwing into live tracking', async () => {
  const store = new ExerciseRecordingStore();
  store.arm(); store.begin('pullup', false);
  store.append(frame(100));
  expect(() => store.append(frame(90))).not.toThrow();
  expect(store.status).toBe('idle');
  expect(store.lastError).toBeTruthy();
  await expect(store.finish()).resolves.toBeUndefined();
  expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
  store.arm(); store.begin('pullup', false);
  await expect(store.finish()).resolves.toBeUndefined();
  expect(store.lastError).toBeTruthy();
});

it('aborts an exercise swap, but can cancel consent separately', async () => {
  const store = new ExerciseRecordingStore();
  store.arm(); store.begin('pullup', false); store.append(frame(100));
  store.abort();
  await store.finish();
  expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
  store.arm(); store.cancel();
  expect(store.begin('squat', false)).toBe(false);
});

it('keeps a storage failure nonfatal and permits the next capture to save', async () => {
  const store = new ExerciseRecordingStore();
  (FileSystem.writeAsStringAsync as jest.Mock).mockRejectedValueOnce(new Error('Disk full'));
  store.arm(); store.begin('pullup', false); store.append(frame(100));
  await expect(store.finish()).resolves.toBeUndefined();
  expect(store.lastError).toContain('Disk full');
  store.arm(); store.begin('squat', false); store.append(frame(200));
  await store.finish();
  expect(FileSystem.moveAsync).toHaveBeenCalledTimes(1);
});

it('round-trips controller resets at their frame boundaries with preserved and cleared counts', async () => {
  const store = new ExerciseRecordingStore();
  store.arm(); store.begin('pullup', false);
  store.reset({ preserveRepCount: true });
  store.append(frame(100));
  store.reset({ preserveRepCount: true });
  store.append(frame(200));
  store.reset();
  store.append(frame(300));
  store.reset({ preserveRepCount: true });
  store.reset({ preserveRepCount: false });
  store.reset({ preserveRepCount: true });
  expect(store.status).toBe('recording');
  expect(store.lastError).toBeNull();
  await store.finish();

  const serialized = (FileSystem.writeAsStringAsync as jest.Mock).mock.calls[0][1];
  (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValueOnce(serialized);
  const loaded = await new ExerciseRecordingStore().loadLatest();
  expect(loaded).toMatchObject({
    workoutId: 'pullup',
    frames: [frame(100), frame(200), frame(300)],
    resets: [
      { beforeFrame: 0, preserveRepCount: true },
      { beforeFrame: 1, preserveRepCount: true },
      { beforeFrame: 2, preserveRepCount: false },
      { beforeFrame: 3, preserveRepCount: false },
    ],
  });
  expect(FileSystem.moveAsync).toHaveBeenCalledTimes(1);
});

it('validates local persisted JSON when loading the latest capture', async () => {
  const store = new ExerciseRecordingStore();
  (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValueOnce(JSON.stringify({
    version: 1, source: 'recorded', stage: 'controller-input', workoutId: 'squat', frames: [frame(10)],
  }));
  expect(await store.loadLatest()).toMatchObject({ workoutId: 'squat' });
  (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValueOnce('{}');
  await expect(store.loadLatest()).rejects.toThrow();
});

it('wires Scan controller resets only to the active capture observer', async () => {
  const store = new ExerciseRecordingStore();
  const onReset = scanResetObserver(store, true, false);
  expect(onReset).toEqual(expect.any(Function));
  store.arm(); store.begin('pullup', false);
  store.append(frame(100));
  const options = Object.freeze({ preserveRepCount: true });
  onReset!(options);
  store.append(frame(200));
  onReset!();
  expect(store.status).toBe('recording');
  await store.finish();
  const serialized = (FileSystem.writeAsStringAsync as jest.Mock).mock.calls[0][1];
  (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValueOnce(serialized);
  expect(await store.loadLatest()).toMatchObject({ resets: [
    { beforeFrame: 1, preserveRepCount: true },
    { beforeFrame: 2, preserveRepCount: false },
  ] });
});

it.each([
  { development: false, fixture: false },
  { development: true, fixture: true },
])('does not forward Scan resets for development=$development fixture=$fixture', async ({ development, fixture }) => {
  const store = new ExerciseRecordingStore();
  store.arm(); store.begin('pullup', false);
  store.append(frame(100));
  const reset = jest.spyOn(store, 'reset');
  const onReset = scanResetObserver(store, development, fixture);
  if (!development) expect(onReset).toBeUndefined();
  onReset?.({ preserveRepCount: true });
  expect(reset).not.toHaveBeenCalled();
  await store.finish();
  const serialized = (FileSystem.writeAsStringAsync as jest.Mock).mock.calls[0][1];
  expect(JSON.parse(serialized).resets).toBeUndefined();
});

it('ignores resets while idle, armed, in fixtures, and after finishing without leaking into the next capture', async () => {
  const store = new ExerciseRecordingStore();
  store.reset();
  expect(store.status).toBe('idle');
  store.arm(); store.reset({ preserveRepCount: true });
  expect(store.status).toBe('armed');
  expect(store.begin('pullup', true)).toBe(false);
  store.reset(); store.append(frame(50)); await store.finish();
  expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
  expect(store.begin('pullup', false)).toBe(true);
  store.append(frame(100)); await store.finish();
  store.reset();
  store.arm(); store.begin('squat', false);
  store.append(frame(200)); await store.finish();
  expect(store.lastError).toBeNull();
  for (const [, serialized] of (FileSystem.writeAsStringAsync as jest.Mock).mock.calls) {
    expect(JSON.parse(serialized).resets).toBeUndefined();
  }
  expect(FileSystem.writeAsStringAsync).toHaveBeenCalledTimes(2);
});

it('ignores resets in production even when a recorder was already active', async () => {
  const store = new ExerciseRecordingStore();
  store.arm(); store.begin('pullup', false); store.append(frame(100));
  const original = __DEV__;
  try {
    (globalThis as any).__DEV__ = false;
    store.reset({ preserveRepCount: true });
    store.append(frame(200));
    await store.finish();
    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
  } finally { (globalThis as any).__DEV__ = original; }
  await store.finish();
  const serialized = (FileSystem.writeAsStringAsync as jest.Mock).mock.calls[0][1];
  expect(JSON.parse(serialized).resets).toBeUndefined();
  expect(JSON.parse(serialized).frames).toEqual([frame(100)]);
});

it('cannot collect or load captures in production even if called directly', async () => {
  const original = __DEV__;
  try {
    (globalThis as any).__DEV__ = false;
    const store = new ExerciseRecordingStore();
    store.arm(); expect(store.begin('squat', false)).toBe(false);
    store.append(frame(100)); await store.finish();
    expect(await store.loadLatest()).toBeNull();
    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
    expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled();
  } finally { (globalThis as any).__DEV__ = original; }
});

it('records exactly one explicitly armed real scan into local storage', async () => {
  const store = new ExerciseRecordingStore();
  expect(store.begin('pullup', false)).toBe(false);
  store.arm();
  expect(store.begin('pullup', true)).toBe(false); // fixtures cannot consume consent
  expect(store.begin('pullup', false)).toBe(true);
  store.append(frame(100));
  store.append(frame(200));
  await store.finish();
  const serialized = (FileSystem.writeAsStringAsync as jest.Mock).mock.calls[0][1];
  expect(JSON.parse(serialized)).toMatchObject({ source: 'recorded', stage: 'controller-input', workoutId: 'pullup', frames: [frame(100), frame(200)] });
  expect(FileSystem.moveAsync).toHaveBeenCalledWith({ from: 'file:///documents/exercise-recording-latest.json.tmp', to: 'file:///documents/exercise-recording-latest.json' });
  expect(store.begin('pullup', false)).toBe(false);
});
