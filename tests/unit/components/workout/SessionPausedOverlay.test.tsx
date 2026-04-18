/**
 * Unit tests for SessionPausedOverlay.
 *
 * Uses the real Zustand store so the overlay's paused-time ticker and
 * resumeSession wiring are exercised end to end.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('moti', () => {
  const { View } = require('react-native');
  return {
    MotiView: View,
  };
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import SessionPausedOverlay from '@/components/workout/SessionPausedOverlay';
import { useSessionRunner } from '@/lib/stores/session-runner';
import type { WorkoutSession } from '@/lib/types/workout-session';

const realResumeSession = useSessionRunner.getState().resumeSession;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedSession() {
  const now = new Date('2026-04-16T12:00:00.000Z').toISOString();
  const session: WorkoutSession = {
    id: 'sess-1',
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
  };
  useSessionRunner.setState({
    activeSession: session,
    isWorkoutInProgress: true,
  });
}

function resetStore() {
  useSessionRunner.setState({
    activeSession: null,
    isWorkoutInProgress: false,
    isPaused: false,
    pausedAt: null,
    totalPausedMs: 0,
    pausedRestTimer: null,
    restTimer: null,
    resumeSession: realResumeSession,
  });
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-04-16T12:00:00.000Z') });
  resetStore();
});

afterEach(() => {
  jest.useRealTimers();
  resetStore();
});

// ===========================================================================
// Visibility
// ===========================================================================

describe('SessionPausedOverlay visibility', () => {
  it('renders nothing when session is not paused', () => {
    seedSession();

    const { queryByTestId } = render(<SessionPausedOverlay />);

    expect(queryByTestId('session-paused-overlay')).toBeNull();
  });

  it('renders the overlay when session is paused', () => {
    seedSession();
    useSessionRunner.setState({ isPaused: true, pausedAt: Date.now() });

    const { getByTestId, getByText } = render(<SessionPausedOverlay />);

    expect(getByTestId('session-paused-overlay')).toBeTruthy();
    expect(getByText('Session paused')).toBeTruthy();
  });

  it('sets accessibilityViewIsModal on the overlay container', () => {
    seedSession();
    useSessionRunner.setState({ isPaused: true, pausedAt: Date.now() });

    const { getByTestId } = render(<SessionPausedOverlay />);

    expect(getByTestId('session-paused-overlay').props.accessibilityViewIsModal).toBe(true);
  });

  it('uses accessibilityLiveRegion="polite" on the duration text', () => {
    seedSession();
    useSessionRunner.setState({ isPaused: true, pausedAt: Date.now() });

    const { getByTestId } = render(<SessionPausedOverlay />);
    const durationNode = getByTestId('session-paused-duration');

    expect(durationNode.props.accessibilityLiveRegion).toBe('polite');
  });
});

// ===========================================================================
// Duration ticker
// ===========================================================================

describe('SessionPausedOverlay duration ticker', () => {
  it('shows 0:00 immediately after pausing', () => {
    seedSession();
    useSessionRunner.setState({ isPaused: true, pausedAt: Date.now() });

    const { getByTestId } = render(<SessionPausedOverlay />);

    expect(getByTestId('session-paused-duration').props.children).toBe('0:00');
  });

  it('ticks every second while paused', () => {
    seedSession();
    useSessionRunner.setState({ isPaused: true, pausedAt: Date.now() });

    const { getByTestId } = render(<SessionPausedOverlay />);

    act(() => {
      jest.advanceTimersByTime(3_000);
    });

    expect(getByTestId('session-paused-duration').props.children).toBe('0:03');
  });

  it('includes previously accumulated paused time in the display', () => {
    seedSession();
    useSessionRunner.setState({
      isPaused: true,
      pausedAt: Date.now(),
      totalPausedMs: 65_000, // 1:05 from earlier pause cycles
    });

    const { getByTestId } = render(<SessionPausedOverlay />);

    act(() => {
      jest.advanceTimersByTime(7_000);
    });

    expect(getByTestId('session-paused-duration').props.children).toBe('1:12');
  });
});

// ===========================================================================
// Actions
// ===========================================================================

describe('SessionPausedOverlay actions', () => {
  it('tapping resume calls resumeSession and hides the overlay', () => {
    seedSession();
    useSessionRunner.setState({ isPaused: true, pausedAt: Date.now() });
    const resumeSpy = jest.fn(() => {
      useSessionRunner.setState({ isPaused: false, pausedAt: null });
    });
    useSessionRunner.setState({ resumeSession: resumeSpy });

    const { getByTestId, queryByTestId } = render(<SessionPausedOverlay />);
    fireEvent.press(getByTestId('session-paused-resume'));

    expect(resumeSpy).toHaveBeenCalled();
    expect(queryByTestId('session-paused-overlay')).toBeNull();
  });

  it('renders and invokes the optional end-session CTA', () => {
    seedSession();
    useSessionRunner.setState({ isPaused: true, pausedAt: Date.now() });
    const endSpy = jest.fn();

    const { getByTestId } = render(<SessionPausedOverlay onEndSession={endSpy} />);
    fireEvent.press(getByTestId('session-paused-end'));

    expect(endSpy).toHaveBeenCalled();
  });

  it('does not render the end-session CTA when onEndSession is not provided', () => {
    seedSession();
    useSessionRunner.setState({ isPaused: true, pausedAt: Date.now() });

    const { queryByTestId } = render(<SessionPausedOverlay />);

    expect(queryByTestId('session-paused-end')).toBeNull();
  });
});
