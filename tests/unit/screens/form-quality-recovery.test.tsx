import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

const mockBack = jest.fn();
let mockSearchParams: Record<string, string | string[] | undefined> = {};

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
  useLocalSearchParams: () => mockSearchParams,
}));

const mockUseRecovery = jest.fn();
jest.mock('@/hooks/use-form-quality-recovery', () => ({
  useFormQualityRecovery: (...args: unknown[]) => mockUseRecovery(...args),
}));

import FormQualityRecoveryScreen from '@/app/(modals)/form-quality-recovery';

const SAMPLE_PRESCRIPTIONS = [
  {
    drill: {
      id: 'tempo-squat-320',
      title: 'Tempo squat',
      category: 'technique' as const,
      durationSec: 180,
      steps: ['step'],
      why: 'fix depth',
      targetFaults: ['shallow_depth'],
    },
    reason: '3 reps with moderate Shallow Depth',
    priority: 1,
    targetFaults: [
      { faultCode: 'shallow_depth', faultDisplayName: 'Shallow Depth', count: 3, maxSeverity: 2 as 1 | 2 | 3 },
    ],
  },
];

const SAMPLE_SUMMARY = {
  sessionId: 'sess-1',
  totalFaults: 5,
  exerciseCount: 2,
  aggregates: [
    { sessionId: 'sess-1', exerciseId: 'squat', totalFaults: 5, byFaultCode: {}, maxSeverity: 2 as 1 | 2 | 3 },
  ],
  fetchedAt: 0,
};

function buildHookResult(overrides: Partial<{
  isLoading: boolean;
  error: string | null;
  prescriptions: typeof SAMPLE_PRESCRIPTIONS;
  summary: typeof SAMPLE_SUMMARY | null;
  explanations: Record<string, { isLoading: boolean; result?: { explanation: string; provider: 'cloud' | 'gemma' | 'openai'; error?: string } }>;
}>) {
  return {
    isLoading: false,
    error: null,
    prescriptions: SAMPLE_PRESCRIPTIONS,
    summary: SAMPLE_SUMMARY,
    refresh: jest.fn(),
    requestExplanation: jest.fn(),
    explanations: {},
    ...overrides,
  };
}

describe('FormQualityRecoveryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = { sessionId: 'sess-1' };
  });

  it('renders summary + prescription list on loaded state', () => {
    mockUseRecovery.mockReturnValue(buildHookResult({}));
    const { getByTestId, getByText } = render(<FormQualityRecoveryScreen />);
    expect(getByTestId('fqr-summary')).toBeTruthy();
    expect(getByText('5')).toBeTruthy();
    expect(getByText('2')).toBeTruthy();
    expect(getByTestId('drill-card-tempo-squat-320')).toBeTruthy();
  });

  it('renders loading state when hook is loading', () => {
    mockUseRecovery.mockReturnValue(buildHookResult({ isLoading: true }));
    const { getByTestId, queryByTestId } = render(<FormQualityRecoveryScreen />);
    expect(getByTestId('fqr-loading')).toBeTruthy();
    expect(queryByTestId('fqr-summary')).toBeNull();
  });

  it('renders error state with retry when hook errors', () => {
    const refresh = jest.fn();
    mockUseRecovery.mockReturnValue(buildHookResult({ error: 'Database offline', refresh } as any));
    const { getByTestId, getByText } = render(<FormQualityRecoveryScreen />);
    expect(getByTestId('fqr-error')).toBeTruthy();
    expect(getByText('Database offline')).toBeTruthy();
    fireEvent.press(getByTestId('fqr-retry'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('renders no-session state when sessionId is missing', () => {
    mockSearchParams = {};
    mockUseRecovery.mockReturnValue(buildHookResult({
      prescriptions: [],
      summary: null,
    }));
    const { getByTestId } = render(<FormQualityRecoveryScreen />);
    expect(getByTestId('fqr-no-session')).toBeTruthy();
  });

  it('renders empty state when prescriptions list is empty', () => {
    mockUseRecovery.mockReturnValue(buildHookResult({
      prescriptions: [],
      summary: { ...SAMPLE_SUMMARY, totalFaults: 0, exerciseCount: 0 },
    }));
    const { getByTestId, getByText } = render(<FormQualityRecoveryScreen />);
    expect(getByTestId('fqr-empty')).toBeTruthy();
    expect(getByText('Clean session.')).toBeTruthy();
  });

  it('back button pops the router', () => {
    mockUseRecovery.mockReturnValue(buildHookResult({}));
    const { getByTestId } = render(<FormQualityRecoveryScreen />);
    fireEvent.press(getByTestId('fqr-back'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('refresh button triggers hook.refresh', () => {
    const refresh = jest.fn();
    mockUseRecovery.mockReturnValue(buildHookResult({ refresh } as any));
    const { getByTestId } = render(<FormQualityRecoveryScreen />);
    fireEvent.press(getByTestId('fqr-refresh'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('invokes requestExplanation when Ask coach tapped on a card', () => {
    const requestExplanation = jest.fn();
    mockUseRecovery.mockReturnValue(buildHookResult({ requestExplanation } as any));
    const { getByTestId } = render(<FormQualityRecoveryScreen />);
    fireEvent.press(getByTestId('drill-toggle-tempo-squat-320'));
    fireEvent.press(getByTestId('drill-explain-tempo-squat-320'));
    expect(requestExplanation).toHaveBeenCalledTimes(1);
    const [drillId, input] = requestExplanation.mock.calls[0];
    expect(drillId).toBe('tempo-squat-320');
    expect(input.drillTitle).toBe('Tempo squat');
    expect(input.exerciseId).toBe('squat');
    expect(input.faults[0].code).toBe('shallow_depth');
    expect(input.faults[0].count).toBe(3);
    expect(input.faults[0].severity).toBe(2);
  });

  it('passes loaded explanation state to the matching card', () => {
    mockUseRecovery.mockReturnValue(buildHookResult({
      explanations: {
        'tempo-squat-320': {
          isLoading: false,
          result: { explanation: 'Because depth!', provider: 'cloud' },
        },
      },
    }));
    const { getByTestId, getByText } = render(<FormQualityRecoveryScreen />);
    fireEvent.press(getByTestId('drill-toggle-tempo-squat-320'));
    expect(getByText('Because depth!')).toBeTruthy();
  });

  it('flips done-state when mark-done pressed', () => {
    mockUseRecovery.mockReturnValue(buildHookResult({}));
    const { getByTestId, queryByTestId } = render(<FormQualityRecoveryScreen />);
    expect(queryByTestId('drill-done-tempo-squat-320')).toBeNull();
    fireEvent.press(getByTestId('drill-mark-done-tempo-squat-320'));
    expect(getByTestId('drill-done-tempo-squat-320')).toBeTruthy();
  });

  it('treats array sessionId param as the first element', () => {
    mockSearchParams = { sessionId: ['sess-a', 'sess-b'] };
    mockUseRecovery.mockReturnValue(buildHookResult({}));
    render(<FormQualityRecoveryScreen />);
    expect(mockUseRecovery).toHaveBeenLastCalledWith('sess-a');
  });
});
