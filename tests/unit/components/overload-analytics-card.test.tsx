import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

const mockGetExerciseHistorySummary = jest.fn();

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('react-native-chart-kit', () => {
  const R = require('react');
  const { View } = require('react-native');
  return {
    LineChart: (props: Record<string, unknown>) =>
      R.createElement(View, { testID: 'mock-line-chart', ...props }),
  };
});

jest.mock('@/lib/services/exercise-history-service', () => ({
  getExerciseHistorySummary: (...args: unknown[]) =>
    mockGetExerciseHistorySummary(...args),
}));

import { OverloadAnalyticsCard } from '../../../components/workouts/OverloadAnalyticsCard';

function sampleSummary(
  overrides: Partial<
    import('../../../lib/services/exercise-history-service').ExerciseHistorySummary
  > = {},
) {
  const set = {
    id: 'set-1',
    weight: 225,
    reps: 5,
    sets: 3,
    date: '2025-04-10',
  };
  return {
    exercise: 'Bench Press',
    sets: [set],
    volumeTrend: { label: 'Volume', values: [3375], dates: ['2025-04-10'] },
    repTrend: { label: 'Reps', values: [5], dates: ['2025-04-10'] },
    lastSession: set,
    prData: [
      {
        category: 'five_rep_max' as const,
        previous: 220,
        current: 225,
        delta: 5,
        isPr: true,
        label: '5RM 225',
      },
    ],
    estimatedOneRepMax: 265,
    ...overrides,
  };
}

describe('OverloadAnalyticsCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetExerciseHistorySummary.mockResolvedValue(sampleSummary());
  });

  it('renders a loading indicator before data resolves', () => {
    const { getByTestId } = render(
      <OverloadAnalyticsCard userId="u1" exercise="Bench Press" />,
    );
    expect(getByTestId('overload-card-loading')).toBeTruthy();
  });

  it('renders header summary + PR chip once data resolves', async () => {
    const { getByText, getByTestId } = render(
      <OverloadAnalyticsCard userId="u1" exercise="Bench Press" />,
    );
    await waitFor(() => expect(getByText('Bench Press')).toBeTruthy());
    expect(getByText(/Last 225 lb · est\. 1RM 265/)).toBeTruthy();
    expect(getByTestId('overload-pr-five_rep_max')).toBeTruthy();
    expect(getByTestId('overload-card-threshold')).toBeTruthy();
  });

  it('uses summaryOverride when provided and skips the network fetch', () => {
    const override = sampleSummary();
    const { getByText } = render(
      <OverloadAnalyticsCard
        userId="u1"
        exercise="Bench Press"
        summaryOverride={override}
      />,
    );
    expect(getByText('Bench Press')).toBeTruthy();
    expect(mockGetExerciseHistorySummary).not.toHaveBeenCalled();
  });

  it('shows an empty state when no sets are present', async () => {
    mockGetExerciseHistorySummary.mockResolvedValueOnce(
      sampleSummary({
        sets: [],
        lastSession: null,
        prData: [],
        estimatedOneRepMax: 0,
        volumeTrend: { label: 'Volume', values: [], dates: [] },
        repTrend: { label: 'Reps', values: [], dates: [] },
      }),
    );
    const { getByTestId, getByText } = render(
      <OverloadAnalyticsCard userId="u1" exercise="Squat" />,
    );
    await waitFor(() => expect(getByTestId('overload-card-empty')).toBeTruthy());
    expect(getByText(/No history yet for this exercise/)).toBeTruthy();
  });

  it('shows an error state when the service rejects', async () => {
    mockGetExerciseHistorySummary.mockRejectedValueOnce(new Error('db cold'));
    const { getByTestId, getByText } = render(
      <OverloadAnalyticsCard userId="u1" exercise="Deadlift" />,
    );
    await waitFor(() => expect(getByTestId('overload-card-error')).toBeTruthy());
    expect(getByText(/db cold/)).toBeTruthy();
  });

  it('forwards the limit prop to the history service', async () => {
    render(
      <OverloadAnalyticsCard userId="u1" exercise="Row" limit={12} />,
    );
    await waitFor(() =>
      expect(mockGetExerciseHistorySummary).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          exerciseNameOrId: 'Row',
          limit: 12,
        }),
      ),
    );
  });
});
