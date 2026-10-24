import React, { useCallback, useEffect } from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { readFileSync } from 'fs';
import path from 'path';
import ts from 'typescript';
import { exerciseRecordingStore } from '@/lib/debug/exercise-recording-store';
import type { ExerciseReplayFrame } from '@/lib/debug/exercise-replay';
import * as FileSystem from 'expo-file-system/legacy';
import { readScanScreenSource } from '../../helpers/scan-screen-source';

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined), moveAsync: jest.fn().mockResolvedValue(undefined),
}));
const filename = path.resolve(process.cwd(), 'app/(tabs)/scan-arkit.tsx');
const sourceText = () => readScanScreenSource();

// Execute only trusted repository source; no external/user text enters this harness.
// Isolate the actual screen's capture callback/effect from unrelated native camera UI.
function loadScanCaptureSlice() {
  const source = ts.createSourceFile(filename, sourceText(), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const screen = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'ScanARKitScreen');
  const nodes = screen!.body!.statements.filter(node =>
    (ts.isVariableStatement(node) && node.declarationList.declarations.some(decl => decl.name.getText(source) === 'onExerciseRecordingFrame')) ||
    (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(source) === 'useEffect' && node.getText(source).includes('exerciseRecordingStore')));
  expect(nodes.length).toBeGreaterThanOrEqual(2);
  const js = ts.transpileModule(`return function useCapture(detectionMode, fixturePlaybackEnabled) { ${nodes.map(node => node.getText(source)).join('\n')} return onExerciseRecordingFrame; }`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return new Function('React', 'useCallback', 'useEffect', 'exerciseRecordingStore', '__DEV__', js)(React, useCallback, useEffect, exerciseRecordingStore, true) as (mode: string, fixture: boolean) => (frame: ExerciseReplayFrame) => void;
}

beforeEach(() => { jest.clearAllMocks(); exerciseRecordingStore.cancel(); });

it('wires capture to live controller input and explicit scan start/stop, guarded in development', () => {
  const text = sourceText();
  expect(text).toMatch(/onFrame:\s*__DEV__\s*\?\s*onExerciseRecordingFrame\s*:\s*undefined/);
  expect(text).toMatch(/if \(__DEV__\) exerciseRecordingStore\.begin\(detectionMode, fixturePlaybackEnabled\);\s*await startNativeTracking\(\)/);
  expect(text).toMatch(/const stopTracking = useCallback\(async \(\) => \{\s*if \(__DEV__\) void exerciseRecordingStore\.finish\(\)/);
  expect(text).toMatch(/__DEV__ && \([\s\S]*?router\.push\('\/exercise-replay'\)/);
});

it('keeps capture across rerenders, rejects fixture frames, and aborts on exercise swaps and unmount', async () => {
  const useCapture = loadScanCaptureSlice();
  const { result, rerender, unmount } = renderHook(({ mode, fixture }: { mode: string; fixture: boolean }) => useCapture(mode, fixture), { initialProps: { mode: 'pullup', fixture: false } });
  exerciseRecordingStore.arm(); exerciseRecordingStore.begin('pullup', false);
  rerender({ mode: 'pullup', fixture: false });
  expect(exerciseRecordingStore.status).toBe('recording');
  rerender({ mode: 'squat', fixture: false });
  expect(exerciseRecordingStore.status).toBe('idle');
  rerender({ mode: 'squat', fixture: true });
  exerciseRecordingStore.arm(); exerciseRecordingStore.begin('squat', false);
  const frame: ExerciseReplayFrame = { timestampMs: 100, angles: { leftElbow: 170, rightElbow: 170, leftShoulder: 170, rightShoulder: 170, leftKnee: 175, rightKnee: 175, leftHip: 175, rightHip: 175 } };
  act(() => result.current(frame));
  await exerciseRecordingStore.finish();
  expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
  rerender({ mode: 'squat', fixture: false });
  exerciseRecordingStore.arm(); exerciseRecordingStore.begin('squat', false);
  unmount();
  expect(exerciseRecordingStore.status).toBe('idle');
});
