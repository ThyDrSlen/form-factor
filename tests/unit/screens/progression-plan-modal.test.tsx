import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

const mockRouterBack = jest.fn();
const mockShowToast = jest.fn();
const mockGetExerciseHistorySummary = jest.fn();
const mockGenerateProgressionPlan = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: mockRouterBack }),
  useLocalSearchParams: () => ({ exercise: 'Bench Press', horizonWeeks: '3' }),
}));

jest.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

jest.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ show: mockShowToast }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('react-native-safe-area-context', () => {
  const ReactRef = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: (props: { children: unknown }) =>
      ReactRef.createElement(View, props),
  };
});

jest.mock('@/lib/services/exercise-history-service', () => ({
  getExerciseHistorySummary: (...args: unknown[]) =>
    mockGetExerciseHistorySummary(...args),
}));

jest.mock('@/lib/services/progression-planner', () => ({
  generateProgressionPlan: (...args: unknown[]) =>
    mockGenerateProgressionPlan(...args),
}));

import ProgressionPlanModal from '../../../app/(modals)/progression-plan';

function sampleSummary() {
  const set = {
    id: 'abc',
    weight: 225,
    reps: 5,
    sets: 3,
    date: '2025-04-10',
  };
  return {
    exercise: 'Bench Press',
    sets: [set],
    volumeTrend: { label: 'Volume', values: [3375], dates: ['2025-04-10'] },
    repTrend: { label: 'Reps per set', values: [5], dates: ['2025-04-10'] },
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
  };
}

describe('ProgressionPlanModal', () => {
  const originalPlanFlag = process.env.EXPO_PUBLIC_PROGRESSION_PLAN;

  beforeEach(() => {
    jest.clearAllMocks();
    // Engaged-behavior tests assume the progression plan flag is on (#475).
    // A dedicated disabled-state test below asserts the off-by-default path.
    process.env.EXPO_PUBLIC_PROGRESSION_PLAN = 'on';
    mockGetExerciseHistorySummary.mockResolvedValue(sampleSummary());
    mockGenerateProgressionPlan.mockResolvedValue({
      text: 'Week 1: 5x5 @ 230.',
      promptPreview: 'prompt',
      generatedAt: new Date().toISOString(),
      horizonWeeks: 3,
      cacheKey: 'cache-key',
    });
  });

  afterAll(() => {
    if (originalPlanFlag === undefined) {
      delete process.env.EXPO_PUBLIC_PROGRESSION_PLAN;
    } else {
      process.env.EXPO_PUBLIC_PROGRESSION_PLAN = originalPlanFlag;
    }
  });

  it('renders a loading state before data resolves', () => {
    const { getByText, getByTestId } = render(<ProgressionPlanModal />);
    expect(getByText(/Analyzing your history/)).toBeTruthy();
    expect(getByTestId('progression-plan-loading')).toBeTruthy();
  });

  it('renders summary and PR chips after data loads', async () => {
    const { getByText } = render(<ProgressionPlanModal />);
    await waitFor(() => {
      expect(getByText('265')).toBeTruthy(); // estimated 1RM
    });
    expect(getByText(/Last set 225 × 5/)).toBeTruthy();
    expect(getByText('5RM')).toBeTruthy();
  });

  it('renders the coach-generated plan text once resolved', async () => {
    const { getByText } = render(<ProgressionPlanModal />);
    await waitFor(() => expect(getByText(/Week 1: 5x5 @ 230/)).toBeTruthy());
    expect(mockGenerateProgressionPlan).toHaveBeenCalledTimes(1);
  });

  it('surfaces an error state when the summary lookup fails', async () => {
    mockGetExerciseHistorySummary.mockRejectedValueOnce(new Error('offline'));
    const { getByText } = render(<ProgressionPlanModal />);
    await waitFor(() => expect(getByText(/offline/)).toBeTruthy());
    expect(getByText(/Try again/)).toBeTruthy();
  });

  it('shows a graceful empty-state when no sets exist', async () => {
    mockGetExerciseHistorySummary.mockResolvedValueOnce({
      ...sampleSummary(),
      sets: [],
      lastSession: null,
      prData: [],
      estimatedOneRepMax: 0,
      volumeTrend: { label: 'Volume', values: [], dates: [] },
      repTrend: { label: 'Reps per set', values: [], dates: [] },
    });
    const { getByText } = render(<ProgressionPlanModal />);
    await waitFor(() =>
      expect(getByText(/No sets logged yet for this exercise/)).toBeTruthy(),
    );
    // Planner should not be invoked when there is no history.
    expect(mockGenerateProgressionPlan).not.toHaveBeenCalled();
  });

  it('renders disabled-state and skips services when flag is off', async () => {
    // Override the engaged-behavior flag set in beforeEach.
    delete process.env.EXPO_PUBLIC_PROGRESSION_PLAN;
    const { getByTestId } = render(<ProgressionPlanModal />);
    expect(getByTestId('progression-plan-disabled')).toBeTruthy();
    // Wait a tick to confirm no async service calls leaked through.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(mockGetExerciseHistorySummary).not.toHaveBeenCalled();
    expect(mockGenerateProgressionPlan).not.toHaveBeenCalled();
  });
});
