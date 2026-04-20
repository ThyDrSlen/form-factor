/**
 * Unit tests for SessionPauseButton.
 *
 * Exercises the button via the real Zustand store so we validate the full
 * pause/resume wiring, not just a mocked callback.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text testID="icon">{name}</Text>;
  },
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success' },
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import SessionPauseButton from '@/components/workout/SessionPauseButton';
import { useSessionRunner } from '@/lib/stores/session-runner';
import type { WorkoutSession } from '@/lib/types/workout-session';

// Snapshot the real store actions once so individual tests can stub them
// with jest.fn() without losing the round-trip integration cases.
const realPauseSession = useSessionRunner.getState().pauseSession;
const realResumeSession = useSessionRunner.getState().resumeSession;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedSession(overrides: Partial<WorkoutSession> = {}) {
  const session = {
    id: 'sess-test',
    user_id: 'user-1',
    template_id: null,
    name: null,
    goal_profile: 'hypertrophy' as const,
    started_at: new Date('2026-04-16T12:00:00.000Z').toISOString(),
    ended_at: null,
    timezone_offset_minutes: 0,
    bodyweight_lb: null,
    notes: null,
    created_at: new Date('2026-04-16T12:00:00.000Z').toISOString(),
    updated_at: new Date('2026-04-16T12:00:00.000Z').toISOString(),
    ...overrides,
  } as WorkoutSession;

  useSessionRunner.setState({
    activeSession: session,
    isWorkoutInProgress: true,
    isPaused: false,
    pausedAt: null,
    totalPausedMs: 0,
    pausedRestTimer: null,
    restTimer: null,
  });
}

function clearSession() {
  useSessionRunner.setState({
    activeSession: null,
    isWorkoutInProgress: false,
    isPaused: false,
    pausedAt: null,
    totalPausedMs: 0,
    pausedRestTimer: null,
    restTimer: null,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: new Date('2026-04-16T12:00:00.000Z') });
  // Restore the real store actions — individual tests may replace them
  // with jest.fn() to isolate interaction assertions.
  useSessionRunner.setState({
    pauseSession: realPauseSession,
    resumeSession: realResumeSession,
  });
  clearSession();
});

afterEach(() => {
  jest.useRealTimers();
  clearSession();
});

// ===========================================================================
// Render / a11y
// ===========================================================================

describe('SessionPauseButton rendering', () => {
  it('renders the pause icon and "Pause workout" label when running', () => {
    seedSession();

    const { getByTestId, getByLabelText } = render(<SessionPauseButton />);

    expect(getByTestId('icon').props.children).toBe('pause');
    expect(getByLabelText('Pause workout')).toBeTruthy();
  });

  it('renders the play icon and "Resume workout" label when paused', () => {
    seedSession();
    useSessionRunner.setState({ isPaused: true, pausedAt: Date.now() });

    const { getByTestId, getByLabelText } = render(<SessionPauseButton />);

    expect(getByTestId('icon').props.children).toBe('play');
    expect(getByLabelText('Resume workout')).toBeTruthy();
  });

  it('exposes accessibilityState.busy=true when paused', () => {
    seedSession();
    useSessionRunner.setState({ isPaused: true, pausedAt: Date.now() });

    const { getByRole } = render(<SessionPauseButton />);
    const btn = getByRole('button');

    expect(btn.props.accessibilityState.busy).toBe(true);
  });

  it('is disabled when no active session exists', () => {
    clearSession();

    const { getByRole } = render(<SessionPauseButton />);
    const btn = getByRole('button');

    expect(btn.props.accessibilityState.disabled).toBe(true);
  });

  it('respects explicit disabled prop even with active session', () => {
    seedSession();

    const { getByRole } = render(<SessionPauseButton disabled />);
    const btn = getByRole('button');

    expect(btn.props.accessibilityState.disabled).toBe(true);
  });
});

// ===========================================================================
// Interaction
// ===========================================================================

describe('SessionPauseButton interaction', () => {
  it('tapping while running calls pauseSession on the store', () => {
    seedSession();
    const pauseSpy = jest.fn();
    useSessionRunner.setState({ pauseSession: pauseSpy });

    const { getByRole } = render(<SessionPauseButton />);
    fireEvent.press(getByRole('button'));

    expect(pauseSpy).toHaveBeenCalledWith('user');
  });

  it('tapping while paused calls resumeSession on the store', () => {
    seedSession();
    useSessionRunner.setState({ isPaused: true, pausedAt: Date.now() });
    const resumeSpy = jest.fn();
    useSessionRunner.setState({ resumeSession: resumeSpy });

    const { getByRole } = render(<SessionPauseButton />);
    fireEvent.press(getByRole('button'));

    expect(resumeSpy).toHaveBeenCalled();
  });

  it('tapping while disabled does nothing', () => {
    clearSession();
    const pauseSpy = jest.fn();
    useSessionRunner.setState({ pauseSession: pauseSpy });

    const { getByRole } = render(<SessionPauseButton />);
    fireEvent.press(getByRole('button'));

    expect(pauseSpy).not.toHaveBeenCalled();
  });

  it('round-trip: pause → resume leaves the session running', () => {
    seedSession();

    const { getByRole } = render(<SessionPauseButton />);
    const btn = getByRole('button');

    fireEvent.press(btn);
    expect(useSessionRunner.getState().isPaused).toBe(true);

    fireEvent.press(btn);
    expect(useSessionRunner.getState().isPaused).toBe(false);
  });
});
