import React from 'react';
import { Alert, Share, StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

const mockPush = jest.fn();
const mockHistory = jest.fn();
const mockLoad = jest.fn();
let mockState: any = { activeSession: null, error: null, loadActiveSession: mockLoad };
const mockWorkouts: any[] = [];
let mockLoading = false;
let mockWeightUnit = 'kg';
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
jest.mock('@/lib/stores/session-runner', () => ({
  useSessionRunner: Object.assign((selector: any) => selector(mockState), { getState: () => mockState }),
}));
jest.mock('@/lib/services/workout-session-history', () => ({ listWorkoutSessionHistory: (...args: any[]) => mockHistory(...args) }));
jest.mock('@/features/auth/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
jest.mock('@/features/workouts/contexts/WorkoutsContext', () => ({
  useWorkouts: () => ({ workouts: mockWorkouts, loading: mockLoading, refreshWorkouts: jest.fn(), deleteWorkout: jest.fn() }),
}));
jest.mock('@/contexts/UnitsContext', () => ({ useUnits: () => ({ getWeightLabel: () => mockWeightUnit, convertWeight: (kg: number) => kg }) }));
jest.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ show: jest.fn() }) }));
jest.mock('@/components', () => ({ DeleteAction: () => null }));
jest.mock('@/features/form-tracking/components/AskCoachCTA', () => ({ AskCoachCTA: () => null }));
jest.mock('@/features/workouts/components/FormQualityBadgeRow', () => ({ FormQualityBadgeRow: () => null }));
jest.mock('@/features/workouts/components/OverloadAnalyticsCard', () => ({ OverloadAnalyticsCard: () => null }));
jest.mock('@/features/workouts/components/WorkoutCardSkeleton', () => ({ WorkoutCardSkeleton: () => null }));
jest.mock('@/lib/services/form-session-history-lookup', () => ({ getMostRecentAvgFqi: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/services/progression-flags', () => ({ isOverloadCardEnabled: () => false, isProgressionPlanEnabled: () => false }));
jest.mock('@/lib/services/session-export-service', () => ({ exportSession: jest.fn() }));
jest.mock('@/lib/services/workout-coach-recall-flag', () => ({ isWorkoutCoachRecallEnabled: () => false }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn().mockResolvedValue(undefined), selectionAsync: jest.fn().mockResolvedValue(undefined), ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: require('react-native').View }));
jest.mock('react-native-gesture-handler', () => ({ Swipeable: require('react-native').View }));

import WorkoutsScreen from '@/app/(tabs)/workouts';

beforeEach(() => {
  jest.clearAllMocks();
  mockWorkouts.length = 0;
  mockLoading = false;
  mockWeightUnit = 'kg';
  mockState = { activeSession: null, error: null, loadActiveSession: mockLoad };
  mockLoad.mockResolvedValue(undefined);
  mockHistory.mockResolvedValue([{ id: 'saved-1', name: 'Upper body', started_at: '2026-10-01T12:00:00Z', ended_at: '2026-10-01T13:00:00Z', completed_set_count: 4, completed_exercise_count: 2 }]);
});

it('gives an active workout clear context and one resume action', async () => {
  mockState.activeSession = { id: 'active-1', name: 'Push day' };
  const screen = render(<WorkoutsScreen />);
  await act(async () => {});
  expect(screen.getByText('Workout in progress')).toBeTruthy();
  expect(screen.getByText('Push day')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Resume workout' })).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Start workout' })).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Resume workout' }));
  expect(mockPush).toHaveBeenCalledWith('/(modals)/workout-session');
});

it('keeps secondary tools readable, finger-sized, and available with history', async () => {
  const screen = render(<WorkoutsScreen />);
  await act(async () => {});
  for (const name of ['Open session timeline', 'Export latest session', 'Browse workout templates']) {
    expect(StyleSheet.flatten(screen.getByRole('button', { name }).props.style).minHeight).toBeGreaterThanOrEqual(44);
  }
  fireEvent.press(screen.getByRole('button', { name: 'Browse workout templates' }));
  expect(mockPush).toHaveBeenCalledWith('/(modals)/templates');
});

it('does not expose an inert quick-log card tap around its working actions', async () => {
  mockWorkouts.push({ id: 'quick-1', exercise: 'Bench Press', sets: 3, reps: 10, weight: 100 });
  const screen = render(<WorkoutsScreen />);
  await act(async () => {});
  expect(screen.queryByLabelText('Bench Press workout')).toBeNull();
  expect(screen.getByRole('button', { name: 'View Bench Press details' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Share Bench Press stats' })).toBeTruthy();
});

it('converts persisted pounds for cards, details, and share in kg', async () => {
  mockWorkouts.push({ id: 'quick-1', exercise: 'Bench Press', sets: 3, reps: 10, weight: 220.462 });
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const screen = render(<WorkoutsScreen />);
  await act(async () => {});
  expect(screen.getByText('100')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('View Bench Press details'));
  expect(alert).toHaveBeenCalledWith('Bench Press', expect.stringContaining('Weight: 100 kg'));
  await act(async () => fireEvent.press(screen.getByLabelText('Share Bench Press stats')));
  expect(share).toHaveBeenCalledWith({ message: expect.stringContaining('Weight: 100 kg') });
  mockWeightUnit = 'lbs';
  screen.rerender(<WorkoutsScreen />);
  expect(screen.getByText('220.46')).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByLabelText('Share Bench Press stats')));
  expect(share).toHaveBeenLastCalledWith({ message: expect.stringContaining('Weight: 220.46 lbs') });
});

it('shows and shares an explicit zero load', async () => {
  mockWorkouts.push({ id: 'zero', exercise: 'Squat', sets: 3, weight: 0 });
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  const screen = render(<WorkoutsScreen />);
  await act(async () => {});
  expect(screen.getByText('0')).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByLabelText('Share Squat stats')));
  expect(share).toHaveBeenCalledWith({ message: expect.stringContaining('Weight: 0 kg') });
});

it('offers one clearly named quick-log action in the empty state', async () => {
  mockHistory.mockResolvedValue([]);
  const screen = render(<WorkoutsScreen />);
  await act(async () => {});
  expect(screen.queryByText('Quick Add (legacy)')).toBeNull();
  expect(screen.getAllByText('Add quick log')).toHaveLength(1);
  fireEvent.press(screen.getByText('Add quick log'));
  expect(mockPush).toHaveBeenCalledWith('/(modals)/add-workout');
  expect(screen.getByLabelText('Start workout')).toBeTruthy();
});

it('keeps session entry and completed sessions visible while quick logs load', async () => {
  mockLoading = true;
  const screen = render(<WorkoutsScreen />);
  await act(async () => {});
  expect(screen.getByLabelText('Start workout')).toBeTruthy();
  expect(screen.getByLabelText('Review Upper body')).toBeTruthy();
  expect(screen.getByTestId('workouts-skeleton-container')).toBeTruthy();
  expect(screen.queryByText('No Workouts Yet')).toBeNull();
});

it('waits for hydration before offering Resume rather than Start', async () => {
  let resolve!: () => void;
  mockLoad.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
  const screen = render(<WorkoutsScreen />);
  expect(screen.queryByLabelText('Start workout')).toBeNull();
  expect(mockLoad).toHaveBeenCalledTimes(1);
  await act(async () => {
    mockState.activeSession = { id: 'active-1' };
    resolve();
  });
  fireEvent.press(screen.getByLabelText('Resume workout'));
  expect(mockPush).toHaveBeenCalledWith('/(modals)/workout-session');
});

it('shows completed sessions independently of empty legacy quick logs and opens review', async () => {
  const screen = render(<WorkoutsScreen />);
  await act(async () => {});
  expect(mockHistory).toHaveBeenCalledWith('user-1');
  expect(screen.getByText('Completed sessions')).toBeTruthy();
  expect(screen.getByText('Quick logs')).toBeTruthy();
  expect(screen.queryByText('No Workouts Yet')).toBeNull();
  fireEvent.press(screen.getByLabelText('Review Upper body'));
  expect(mockPush).toHaveBeenCalledWith('/(modals)/session-history?sessionId=saved-1');
});
