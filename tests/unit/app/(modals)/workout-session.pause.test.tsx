/**
 * Screen-level tests for the pause/resume integration in the workout session
 * modal. Covers:
 *   - Pause button renders in the header.
 *   - Tapping the button flips store `isPaused`.
 *   - Overlay renders when the store reports `isPaused=true`.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mocks — heavy dependencies replaced with inert stubs.
// ---------------------------------------------------------------------------

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name, testID }: { name: string; testID?: string }) => {
    const { Text } = require('react-native');
    return <Text testID={testID ?? `icon-${name}`}>{name}</Text>;
  },
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success' },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

jest.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ show: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

jest.mock('@gorhom/bottom-sheet', () => {
  const { View } = require('react-native');
  const React = require('react');
  return {
    __esModule: true,
    default: React.forwardRef(({ children }: { children: React.ReactNode }, _ref: unknown) => (
      <View>{children}</View>
    )),
    BottomSheetView: View,
    BottomSheetModalProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

jest.mock('moti', () => {
  const { View } = require('react-native');
  return { MotiView: View };
});

// Swap the sub-components for stubs so we only render the chrome we care about.
jest.mock('@/components/workout/ExerciseCard', () => () => null);
jest.mock('@/components/workout/TimerPill', () => () => null);
jest.mock('@/components/workout/SessionMetaCard', () => () => null);
jest.mock('@/components/workout/SetActionSheet', () => () => null);
jest.mock('@/components/workout/ExerciseActionSheet', () => () => null);
jest.mock('@/components/workout/RestTimerSheet', () => () => null);
jest.mock('@/components/workout/ExercisePicker', () => () => null);
jest.mock('@/components/workout/SetNotesModal', () => () => null);

// ---------------------------------------------------------------------------
// Imports (post-mock)
// ---------------------------------------------------------------------------

import WorkoutSessionScreen from '@/app/(modals)/workout-session';
import { useSessionRunner } from '@/lib/stores/session-runner';
import type { WorkoutSession } from '@/lib/types/workout-session';

const realPauseSession = useSessionRunner.getState().pauseSession;
const realResumeSession = useSessionRunner.getState().resumeSession;
const realLoadActiveSession = useSessionRunner.getState().loadActiveSession;
const realStartSession = useSessionRunner.getState().startSession;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedActiveSession(overrides: Partial<WorkoutSession> = {}) {
  const now = new Date('2026-04-16T12:00:00.000Z').toISOString();
  const session: WorkoutSession = {
    id: 'sess-screen',
    user_id: 'user-1',
    template_id: null,
    name: null,
    goal_profile: 'hypertrophy',
    started_at: now,
    ended_at: null,
    timezone_offset_minutes: 0,
    bodyweight_lb: null,
    notes: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };

  useSessionRunner.setState({
    activeSession: session,
    exercises: [],
    sets: {},
    isWorkoutInProgress: true,
    isPaused: false,
    pausedAt: null,
    totalPausedMs: 0,
    pausedRestTimer: null,
    restTimer: null,
    isLoading: false,
    // No-op lifecycle actions so useEffect doesn't try to persist via the DB.
    loadActiveSession: jest.fn().mockResolvedValue(undefined),
    startSession: jest.fn().mockResolvedValue(undefined),
  });
}

function resetStore() {
  useSessionRunner.setState({
    activeSession: null,
    exercises: [],
    sets: {},
    isWorkoutInProgress: false,
    isPaused: false,
    pausedAt: null,
    totalPausedMs: 0,
    pausedRestTimer: null,
    restTimer: null,
    isLoading: false,
    pauseSession: realPauseSession,
    resumeSession: realResumeSession,
    loadActiveSession: realLoadActiveSession,
    startSession: realStartSession,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: new Date('2026-04-16T12:00:00.000Z') });
  resetStore();
});

afterEach(() => {
  jest.useRealTimers();
  resetStore();
});

// ===========================================================================
// Tests
// ===========================================================================

describe('WorkoutSessionScreen pause integration', () => {
  it('renders the SessionPauseButton in the header when a session is active', async () => {
    seedActiveSession();

    const { getByTestId } = render(<WorkoutSessionScreen />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(getByTestId('session-pause-button')).toBeTruthy();
  });

  it('tapping the header pause button invokes the store pause action', async () => {
    seedActiveSession();
    const pauseSpy = jest.fn();
    useSessionRunner.setState({ pauseSession: pauseSpy });

    const { getByTestId } = render(<WorkoutSessionScreen />);

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.press(getByTestId('session-pause-button'));

    expect(pauseSpy).toHaveBeenCalledWith('user');
  });

  it('does not render the paused overlay while the session is running', async () => {
    seedActiveSession();

    const { queryByTestId } = render(<WorkoutSessionScreen />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(queryByTestId('session-paused-overlay')).toBeNull();
  });

  it('renders the paused overlay when isPaused=true in the store', async () => {
    seedActiveSession();
    useSessionRunner.setState({ isPaused: true, pausedAt: Date.now() });

    const { getByTestId } = render(<WorkoutSessionScreen />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(getByTestId('session-paused-overlay')).toBeTruthy();
    expect(getByTestId('session-paused-resume')).toBeTruthy();
  });
});
