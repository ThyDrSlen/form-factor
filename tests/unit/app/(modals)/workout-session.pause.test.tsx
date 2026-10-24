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

const mockReplace = jest.fn();
const mockToast = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: mockReplace }),
  useLocalSearchParams: () => ({}),
}));

jest.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ show: mockToast }),
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
jest.mock('@/features/workouts/components/ExerciseCard', () => () => null);
jest.mock('@/features/workouts/components/TimerPill', () => () => null);
jest.mock('@/features/workouts/components/SessionMetaCard', () => () => null);
jest.mock('@/features/workouts/components/SetActionSheet', () => () => null);
jest.mock('@/features/workouts/components/ExerciseActionSheet', () => () => null);
jest.mock('@/features/workouts/components/RestTimerSheet', () => () => null);
jest.mock('@/features/workouts/components/ExercisePicker', () => () => null);
jest.mock('@/features/workouts/components/SetNotesModal', () => () => null);

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
const realFinishSession = useSessionRunner.getState().finishSession;

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
    error: null,
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
    error: null,
    pauseSession: realPauseSession,
    resumeSession: realResumeSession,
    loadActiveSession: realLoadActiveSession,
    startSession: realStartSession,
    finishSession: realFinishSession,
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

describe('WorkoutSessionScreen finish integration', () => {
  it.each(['rejected', 'not-saved'])('keeps the session open after %s finish and permits retry', async (failure) => {
    seedActiveSession();
    const finish = jest.fn().mockImplementationOnce(async () => {
      if (failure === 'rejected') throw new Error('Disk unavailable');
    }).mockImplementationOnce(async () => {
      useSessionRunner.setState({ activeSession: null });
    });
    useSessionRunner.setState({ finishSession: finish });
    const alert = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
    try {
      const screen = render(<WorkoutSessionScreen />);
      await act(async () => {});
      for (let attempt = 0; attempt < 2; attempt++) {
        fireEvent.press(screen.getByLabelText('Finish workout'));
        const buttons = alert.mock.calls[attempt][2] as { text: string; onPress: () => Promise<void> }[];
        await act(async () => { await buttons.find(button => button.text === 'Finish')!.onPress(); });
        if (attempt === 0) {
          expect(useSessionRunner.getState().activeSession?.id).toBe('sess-screen');
          expect(mockReplace).not.toHaveBeenCalled();
          expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('retry'), { type: 'error' });
        }
      }
      expect(finish).toHaveBeenCalledTimes(2);
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith('/(modals)/session-history?sessionId=sess-screen');
    } finally { alert.mockRestore(); }
  });

  it('does not finish a different session through a stale confirmation', async () => {
    seedActiveSession();
    const finish = jest.fn().mockResolvedValue(undefined);
    useSessionRunner.setState({ finishSession: finish });
    const alert = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
    try {
      const screen = render(<WorkoutSessionScreen />);
      await act(async () => {});
      fireEvent.press(screen.getByLabelText('Finish workout'));
      const buttons = alert.mock.calls[0][2] as { text: string; onPress: () => Promise<void> }[];
      await act(async () => { seedActiveSession({ id: 'another-session' }); });
      await act(async () => { await buttons.find(button => button.text === 'Finish')!.onPress(); });
      expect(finish).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
      expect(useSessionRunner.getState().activeSession?.id).toBe('another-session');
    } finally { alert.mockRestore(); }
  });
  it('guards repeated confirmation and reviews the saved session after store reset', async () => {
    seedActiveSession();
    let complete!: () => void;
    const finish = jest.fn(() => new Promise<void>((resolve) => { complete = resolve; }));
    useSessionRunner.setState({ finishSession: finish });
    const alert = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
    const screen = render(<WorkoutSessionScreen />);
    await act(async () => {});
    fireEvent.press(screen.getByLabelText('Finish workout'));
    const confirm = (alert.mock.calls[0][2] as { text: string; onPress: () => Promise<void> }[]).find(b => b.text === 'Finish')!;
    let first!: Promise<void>;
    await act(async () => {
      first = confirm.onPress();
      void confirm.onPress();
    });
    expect(finish).toHaveBeenCalledTimes(1);
    await act(async () => {
      useSessionRunner.setState({ activeSession: null });
      complete();
      await first;
    });
    expect(mockReplace).toHaveBeenCalledWith('/(modals)/session-history?sessionId=sess-screen');
    alert.mockRestore();
  });
});

describe('WorkoutSessionScreen initialization', () => {
  it('does not start a new workout after hydration fails and offers retry', async () => {
    seedActiveSession();
    const start = jest.fn().mockResolvedValue(undefined);
    const load = jest.fn(async () => {
      useSessionRunner.setState({ error: 'Storage unavailable' });
    });
    useSessionRunner.setState({ activeSession: null, loadActiveSession: load, startSession: start, error: null });
    const screen = render(<WorkoutSessionScreen />);
    await act(async () => {});
    expect(start).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Retry opening workout')).toBeTruthy();
    load.mockImplementation(async () => {
      useSessionRunner.setState({ error: null });
      seedActiveSession();
    });
    fireEvent.press(screen.getByLabelText('Retry opening workout'));
    await act(async () => {});
    expect(screen.getByLabelText('Finish workout')).toBeTruthy();
  });
});

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
