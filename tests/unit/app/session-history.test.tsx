import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { localDB } from '@/lib/services/database/local-db';
import SessionHistoryScreen from '@/app/(modals)/session-history';
import { listWorkoutSessionHistory, getWorkoutSessionHistoryDetail } from '@/lib/services/workout-session-history';

const mockPush = jest.fn();
let mockParams: { sessionId?: string } = {};
let mockUser: { id: string } | null = { id: 'u1' };
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams, useRouter: () => ({ back: jest.fn(), push: mockPush }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('@/features/auth/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/contexts/UnitsContext', () => ({ useUnits: () => ({ convertWeight: (kg: number) => kg, getWeightLabel: () => 'kg' }) }));
jest.mock('@/lib/services/database/local-db', () => ({ localDB: { supportsWorkoutSync: true } }));
jest.mock('@/lib/services/workout-session-history', () => ({ listWorkoutSessionHistory: jest.fn(), getWorkoutSessionHistoryDetail: jest.fn() }));
const summary = { id: 'session', name: 'Upper', started_at: '2026-01-01', ended_at: '2026-01-02', completed_exercise_count: 1, completed_set_count: 1 };
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  Object.assign(localDB, { supportsWorkoutSync: true });
  mockUser = { id: 'u1' };
  jest.mocked(listWorkoutSessionHistory).mockResolvedValue([summary]);
  jest.mocked(getWorkoutSessionHistoryDetail).mockResolvedValue({ ...summary, exercises: [{ id: 'e1', name: 'Bench press', sets: [{ id: 's1', sort_order: 0, set_type: 'normal', actual_reps: 8, actual_seconds: null, actual_weight: 100, completed_at: '2026-01-01' }] }] });
});

test('opens the requested saved session without another tap', async () => {
  mockParams = { sessionId: 'session' };
  const view = render(<SessionHistoryScreen />);
  expect(await view.findByText('Bench press')).toBeTruthy();
  expect(getWorkoutSessionHistoryDetail).toHaveBeenCalledWith('u1', 'session');
});

test('explains a requested session missing from verified history and allows retry', async () => {
  mockParams = { sessionId: 'session' };
  jest.mocked(listWorkoutSessionHistory).mockResolvedValueOnce([]);
  const view = render(<SessionHistoryScreen />);
  expect(await view.findByText('This session is not available in verified history yet. Connect and sync, then retry.')).toBeTruthy();
  expect(view.queryByText('No completed sessions yet')).toBeNull();
  fireEvent.press(view.getByText('Retry'));
  expect(await view.findByText('Bench press')).toBeTruthy();
});

test('signed-out and web states are explanatory, not empty or retryable failures', () => {
  mockUser = null;
  const view = render(<SessionHistoryScreen />);
  expect(view.getByText('Sign in to view your session history.')).toBeTruthy();
  expect(listWorkoutSessionHistory).not.toHaveBeenCalled();
  mockUser = { id: 'u1' };
  Object.assign(localDB, { supportsWorkoutSync: false });
  view.rerender(<SessionHistoryScreen />);
  expect(view.getByText('Session history is available in the mobile app.')).toBeTruthy();
  expect(view.queryByText('Retry')).toBeNull();
  expect(listWorkoutSessionHistory).not.toHaveBeenCalled();
});

test('loads owned completed sessions and expands real sets inline with pound storage converted to preferred units', async () => {
  const view = render(<SessionHistoryScreen />);
  await waitFor(() => expect(listWorkoutSessionHistory).toHaveBeenCalledWith('u1'));
  expect(await view.findByText('1 completed set')).toBeTruthy();
  fireEvent.press(view.getByTestId('session-card-session'));
  expect(await view.findByText('Bench press')).toBeTruthy();
  expect(view.getByText(/8 reps.*45.4 kg/)).toBeTruthy();
  expect(getWorkoutSessionHistoryDetail).toHaveBeenCalledWith('u1', 'session');
  expect(mockPush).not.toHaveBeenCalled();
  fireEvent.press(view.getByTestId('session-card-session'));
  expect(view.queryByText('Bench press')).toBeNull();
});
