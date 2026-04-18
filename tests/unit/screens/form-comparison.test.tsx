import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import FormComparisonModal from '@/app/(modals)/form-comparison';

const mockBack = jest.fn();
const mockParams: { sessionId?: string; exerciseId?: string } = {};

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user_1' } }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('react-native-safe-area-context', () => {
  const RN = jest.requireActual('react-native');
  const R = jest.requireActual('react');
  const SafeAreaView = (props: { children: React.ReactNode }) =>
    R.createElement(RN.View, null, props.children);
  return { SafeAreaView };
});

const mockFetcher = jest.fn();
jest.mock('@/lib/services/session-comparison-aggregator', () => {
  const actual = jest.requireActual('@/lib/services/session-comparison-aggregator');
  return {
    ...actual,
    fetchSessionsForComparison: (args: unknown) => mockFetcher(args),
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockParams.sessionId = undefined;
  mockParams.exerciseId = undefined;
});

describe('<FormComparisonModal />', () => {
  it('renders empty state when required params are missing', () => {
    const { getByTestId } = render(<FormComparisonModal />);
    expect(getByTestId('empty-state')).toBeTruthy();
  });

  it('renders loading state then comparison card on success', async () => {
    mockParams.sessionId = 'sess_curr';
    mockParams.exerciseId = 'squat';
    mockFetcher.mockResolvedValue({
      current: {
        sessionId: 'sess_curr',
        exerciseId: 'squat',
        completedAt: '2026-04-17T12:00:00Z',
        repCount: 5,
        avgFqi: 80,
        avgRomDeg: 100,
        avgDepthRatio: 0.9,
        avgSymmetryDeg: 4,
        faultCounts: {},
      },
      prior: null,
    });

    const { queryByTestId, getByTestId } = render(<FormComparisonModal />);
    expect(queryByTestId('loading-state')).toBeTruthy();
    await waitFor(() =>
      expect(getByTestId('session-comparison-card')).toBeTruthy(),
    );
  });

  it('renders error state with retry button on fetcher failure', async () => {
    mockParams.sessionId = 'sess_curr';
    mockParams.exerciseId = 'squat';
    mockFetcher.mockRejectedValue(new Error('network down'));

    const { getByTestId } = render(<FormComparisonModal />);
    await waitFor(() => expect(getByTestId('error-state')).toBeTruthy());
    expect(getByTestId('retry-button')).toBeTruthy();
  });

  it('calls router.back when close button is pressed', () => {
    const { getByTestId } = render(<FormComparisonModal />);
    fireEvent.press(getByTestId('close-button'));
    expect(mockBack).toHaveBeenCalled();
  });
});
