import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import ExerciseReplayScreen from '@/app/(modals)/exercise-replay';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import { Share } from 'react-native';
import { logRep } from '@/lib/services/rep-logger';
import { hapticBus } from '@/lib/haptics/haptic-bus';
import { exerciseRecordingStore } from '@/lib/debug/exercise-recording-store';

const recording = {
  version: 1, source: 'recorded', stage: 'controller-input', workoutId: 'pullup',
  frames: [170, 170, 120, 120, 60, 60, 170, 170].map((elbow, i) => ({
    timestampMs: 100 + i * 500,
    angles: { leftElbow: elbow, rightElbow: elbow, leftShoulder: 170, rightShoulder: 170,
      leftKnee: 175, rightKnee: 175, leftHip: 175, rightHip: 175 },
  })),
};

beforeEach(() => {
  jest.clearAllMocks();
  exerciseRecordingStore.cancel();
  (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true });
  (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue(JSON.stringify(recording));
});

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn() }) }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/', cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: false }),
  readAsStringAsync: jest.fn(), writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/services/rep-logger', () => ({ logRep: jest.fn() }));
jest.mock('@/lib/haptics/haptic-bus', () => ({ hapticBus: { emit: jest.fn() } }));
jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), warnWithTs: jest.fn(), errorWithTs: jest.fn() }));

it('explains the capture boundary and requires explicit consent before arming', () => {
  const screen = render(<ExerciseReplayScreen />);
  expect(screen.getByText(/controller-input/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Arm next scan recording' })).toBeDisabled();
  fireEvent.press(screen.getByRole('checkbox'));
  expect(screen.getByRole('button', { name: 'Arm next scan recording' })).toBeEnabled();
  fireEvent.press(screen.getByRole('button', { name: 'Arm next scan recording' }));
  expect(screen.getByText(/Armed for the next real scan/)).toBeTruthy();
});

it('steps, runs and restarts the real controller deterministically without live side effects', async () => {
  const screen = render(<ExerciseReplayScreen />);
  fireEvent.press(screen.getByRole('button', { name: 'Load latest capture' }));
  await waitFor(() => expect(screen.getByText('Recorded · pullup')).toBeTruthy());
  expect(screen.getByText('Frame 0 / 8')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Step' }));
  expect(screen.getByText('Frame 1 / 8')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Step' }));
  expect(screen.getByText('Frame 2 / 8')).toBeTruthy();
  expect(screen.getByText('Phase: hang')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Run' }));
  expect(screen.getByText('Frame 8 / 8')).toBeTruthy();
  expect(screen.getByText('Reps: 1')).toBeTruthy();
  expect(screen.queryByText('FQI: —')).toBeNull();
  const score = screen.getByText(/^FQI:/).props.children;
  expect(logRep).not.toHaveBeenCalled();
  expect(hapticBus.emit).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Restart' }));
  expect(screen.getByText('Frame 0 / 8')).toBeTruthy();
  expect(screen.getByText('Reps: 0')).toBeTruthy();
  expect(screen.getByText('FQI: —')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Run' }));
  expect(screen.getByText('Reps: 1')).toBeTruthy();
  expect(screen.getByText(/^FQI:/).props.children).toEqual(score);
});

it('offers a labeled synthetic demo without requiring a saved capture or camera', () => {
  const screen = render(<ExerciseReplayScreen />);
  fireEvent.press(screen.getByRole('button', { name: 'Load synthetic curl demo' }));
  expect(screen.getByText('Synthetic · dumbbell_curl')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Run' }));
  expect(screen.getByText('Reps: 1')).toBeTruthy();
  expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled();
  expect(logRep).not.toHaveBeenCalled();
  expect(hapticBus.emit).not.toHaveBeenCalled();
});

it('preserves completed reps when replaying a recorded tracking-loss reset', async () => {
  const frames = [...recording.frames, ...recording.frames].map((frame, i) => ({ ...frame, timestampMs: 100 + i * 500 }));
  (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue(JSON.stringify({
    ...recording, frames, resets: [{ beforeFrame: 8, preserveRepCount: true }],
  }));
  const screen = render(<ExerciseReplayScreen />);
  fireEvent.press(screen.getByRole('button', { name: 'Load latest capture' }));
  await waitFor(() => expect(screen.getByText('Frame 0 / 16')).toBeTruthy());
  fireEvent.press(screen.getByRole('button', { name: 'Run' }));
  expect(screen.getByText('Reps: 2')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Restart' }));
  expect(screen.getByText('Reps: 0')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Run' }));
  expect(screen.getByText('Reps: 2')).toBeTruthy();
});

it('discards an interrupted rep while retaining completed reps and their displayed score', async () => {
  const frames = [...recording.frames, ...recording.frames].map((frame, i) => ({ ...frame, timestampMs: 100 + i * 500 }));
  (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue(JSON.stringify({
    ...recording, frames, resets: [{ beforeFrame: 12, preserveRepCount: true }],
  }));
  const screen = render(<ExerciseReplayScreen />);
  fireEvent.press(screen.getByRole('button', { name: 'Load latest capture' }));
  await waitFor(() => expect(screen.getByText('Frame 0 / 16')).toBeTruthy());
  for (let i = 0; i < 12; i++) fireEvent.press(screen.getByRole('button', { name: 'Step' }));
  expect(screen.getByText('Reps: 1')).toBeTruthy();
  expect(screen.queryByText('FQI: —')).toBeNull();
  const score = screen.getByText(/^FQI:/).props.children;
  fireEvent.press(screen.getByRole('button', { name: 'Step' }));
  expect(screen.getByText('Reps: 1')).toBeTruthy();
  expect(screen.getByText(/^FQI:/).props.children).toEqual(score);
  fireEvent.press(screen.getByRole('button', { name: 'Run' }));
  expect(screen.getByText('Reps: 1')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Restart' }));
  expect(screen.getByText('Reps: 0')).toBeTruthy();
  expect(screen.getByText('FQI: —')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Run' }));
  expect(screen.getByText('Reps: 1')).toBeTruthy();
  expect(screen.getByText(/^FQI:/).props.children).toEqual(score);
  expect(logRep).not.toHaveBeenCalled();
  expect(hapticBus.emit).not.toHaveBeenCalled();
});

it('imports labeled synthetic JSON and shares a file URL instead of a giant JSON message', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///picked.json', size: 1000 }] });
  (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue(JSON.stringify({ ...recording, source: 'synthetic' }));
  const screen = render(<ExerciseReplayScreen />);
  fireEvent.press(screen.getByRole('button', { name: 'Import JSON' }));
  await waitFor(() => expect(screen.getByText('Synthetic · pullup')).toBeTruthy());
  fireEvent.press(screen.getByRole('button', { name: 'Export JSON' }));
  await waitFor(() => expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: 'file:///cache/exercise-replay-export.json' })));
  expect(share.mock.calls[0][0]).not.toHaveProperty('message');
  share.mockRestore();
});

it('rejects malformed imports without destroying the previously loaded replay', async () => {
  const screen = render(<ExerciseReplayScreen />);
  fireEvent.press(screen.getByRole('button', { name: 'Load latest capture' }));
  await waitFor(() => expect(screen.getByText('Frame 0 / 8')).toBeTruthy());
  (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///picked.json' }] });
  (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue('{}');
  fireEvent.press(screen.getByRole('button', { name: 'Import JSON' }));
  await waitFor(() => expect(screen.getByText(/Unable to load recording:/)).toBeTruthy());
  expect(screen.getByText('Recorded · pullup')).toBeTruthy();
});

it('does not expose replay or capture controls in production', () => {
  const original = __DEV__;
  try {
    (globalThis as any).__DEV__ = false;
    const screen = render(<ExerciseReplayScreen />);
    expect(screen.queryByRole('button', { name: 'Arm next scan recording' })).toBeNull();
    expect(screen.getByText('Developer tool unavailable')).toBeTruthy();
  } finally { (globalThis as any).__DEV__ = original; }
});
