/**
 * Unit tests for ExerciseHistoryStrip.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { ExerciseHistoryStrip } from '@/components/form-tracking/ExerciseHistoryStrip';
import { EMPTY_EXERCISE_HISTORY } from '@/lib/services/exercise-history';

describe('ExerciseHistoryStrip', () => {
  it('renders nothing when summary is empty', () => {
    const { queryByTestId } = render(<ExerciseHistoryStrip summary={EMPTY_EXERCISE_HISTORY} />);
    expect(queryByTestId('exercise-history-strip')).toBeNull();
  });

  it('renders three chips when full history is present', () => {
    const summary = {
      lastSession: {
        sessionId: 'sess-1',
        endedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        sets: 3,
        totalReps: 24,
        topWeightLb: 185,
        avgFqi: 85,
      },
      last5SessionsAvgFqi: 81.5,
      maxReps: 12,
      maxVolume: 2350,
    };
    const { getByTestId } = render(<ExerciseHistoryStrip summary={summary} />);
    expect(getByTestId('exercise-history-strip-last-session')).toBeTruthy();
    expect(getByTestId('exercise-history-strip-avg-fqi')).toBeTruthy();
    expect(getByTestId('exercise-history-strip-personal-best')).toBeTruthy();
  });

  it('formats last-session value with weight and volume when present', () => {
    const summary = {
      lastSession: {
        sessionId: 'sess-1',
        endedAt: new Date().toISOString(),
        sets: 4,
        totalReps: 32,
        topWeightLb: 200,
        avgFqi: null,
      },
      last5SessionsAvgFqi: null,
      maxReps: 10,
      maxVolume: 1800,
    };
    const { getByText } = render(<ExerciseHistoryStrip summary={summary} />);
    expect(getByText('4×32 @ 200 lb')).toBeTruthy();
    expect(getByText('10 reps · 1.8k lb')).toBeTruthy();
  });

  it('omits chips that have no data', () => {
    const summary = {
      lastSession: null,
      last5SessionsAvgFqi: 72,
      maxReps: null,
      maxVolume: null,
    };
    const { getByTestId, queryByTestId } = render(<ExerciseHistoryStrip summary={summary} />);
    expect(getByTestId('exercise-history-strip-avg-fqi')).toBeTruthy();
    expect(queryByTestId('exercise-history-strip-last-session')).toBeNull();
    expect(queryByTestId('exercise-history-strip-personal-best')).toBeNull();
  });
});
