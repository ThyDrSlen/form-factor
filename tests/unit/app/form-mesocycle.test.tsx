/**
 * form-mesocycle modal — inline analyst render tests.
 *
 * Covers the wiring added for #541:
 *   - "Ask coach" now triggers requestMesocycleAnalysis and renders the
 *     result inline (loading → result → error).
 *   - "Continue in chat" still deep-links into the coach tab with the
 *     built prompt + mesocycle-analyst focus.
 *
 * The real sendCoachPrompt is mocked at the coach-service boundary so we
 * don't need to touch the edge-function or provider pipeline.
 */

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import FormMesocycleModal from '@/app/(modals)/form-mesocycle';
import type {
  MesocycleInsights,
} from '@/lib/services/form-mesocycle-aggregator';

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));

const mockSendCoachPrompt = jest.fn();
jest.mock('@/lib/services/coach-service', () => ({
  sendCoachPrompt: (...args: unknown[]) => mockSendCoachPrompt(...args),
}));

const mockUseFormMesocycle = jest.fn();
jest.mock('@/hooks/use-form-mesocycle', () => ({
  useFormMesocycle: () => mockUseFormMesocycle(),
}));

function baseInsights(overrides: Partial<MesocycleInsights> = {}): MesocycleInsights {
  const weeks = overrides.weeks ?? [
    {
      weekIndex: 0,
      weekStartIso: '2026-03-30',
      weekEndIso: '2026-04-05',
      sessionsCount: 2,
      repsCount: 20,
      avgFqi: 78,
      faultCounts: {},
    },
    {
      weekIndex: 1,
      weekStartIso: '2026-04-06',
      weekEndIso: '2026-04-12',
      sessionsCount: 3,
      repsCount: 30,
      avgFqi: 82,
      faultCounts: {},
    },
  ];
  return {
    generatedAt: '2026-04-21T00:00:00.000Z',
    weeks,
    topFaults: overrides.topFaults ?? [],
    deload: overrides.deload ?? {
      severity: 'none',
      reason: null,
      fqiDelta: 4,
      faultDelta: 0,
    },
    isEmpty: false,
    ...overrides,
  } as MesocycleInsights;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseFormMesocycle.mockReturnValue({
    loading: false,
    error: null,
    insights: baseInsights(),
    refresh: jest.fn(),
  });
});

describe('<FormMesocycleModal />', () => {
  it('mounts the inline analyst section when insights are present', () => {
    const { getByTestId } = render(<FormMesocycleModal />);
    expect(getByTestId('form-mesocycle-analyst-section')).toBeTruthy();
    // Not loading/errored/resolved yet — no body rows visible.
    expect(() => getByTestId('form-mesocycle-analyst-loading')).toThrow();
    expect(() => getByTestId('form-mesocycle-analyst-error')).toThrow();
    expect(() => getByTestId('form-mesocycle-analyst-result')).toThrow();
  });

  it('renders the analyst result inline after "Ask coach" succeeds', async () => {
    mockSendCoachPrompt.mockResolvedValueOnce({
      role: 'assistant',
      content: 'Your last 4 weeks show steady FQI gains. Focus on ROM depth.',
      provider: 'gemma-cloud',
    });

    const { getByTestId, getByText } = render(<FormMesocycleModal />);
    const askCoach = getByTestId('form-mesocycle-ask-coach');
    await act(async () => {
      fireEvent.press(askCoach);
    });

    await waitFor(() => {
      expect(getByTestId('form-mesocycle-analyst-result')).toBeTruthy();
    });
    expect(
      getByText('Your last 4 weeks show steady FQI gains. Focus on ROM depth.'),
    ).toBeTruthy();
    expect(getByTestId('form-mesocycle-analyst-provider').props.children.join('')).toContain(
      'Gemma',
    );
  });

  it('renders an inline error + retry when the analyst throws', async () => {
    mockSendCoachPrompt.mockRejectedValueOnce(new Error('upstream 500'));

    const { getByTestId, getByText } = render(<FormMesocycleModal />);
    await act(async () => {
      fireEvent.press(getByTestId('form-mesocycle-ask-coach'));
    });

    await waitFor(() => {
      expect(getByTestId('form-mesocycle-analyst-error')).toBeTruthy();
    });
    expect(getByText('upstream 500')).toBeTruthy();

    // Retry → successful second call.
    mockSendCoachPrompt.mockResolvedValueOnce({
      role: 'assistant',
      content: 'All good, keep it up.',
    });
    await act(async () => {
      fireEvent.press(getByTestId('form-mesocycle-analyst-retry'));
    });

    await waitFor(() => {
      expect(getByTestId('form-mesocycle-analyst-result')).toBeTruthy();
    });
  });

  it('"Continue in chat" deep-links to coach tab with prefill + focus', async () => {
    mockSendCoachPrompt.mockResolvedValueOnce({
      role: 'assistant',
      content: 'Lift steady next week.',
    });
    const { getByTestId } = render(<FormMesocycleModal />);
    await act(async () => {
      fireEvent.press(getByTestId('form-mesocycle-ask-coach'));
    });
    await waitFor(() => {
      expect(getByTestId('form-mesocycle-analyst-continue-chat')).toBeTruthy();
    });
    fireEvent.press(getByTestId('form-mesocycle-analyst-continue-chat'));
    expect(mockPush).toHaveBeenCalledTimes(1);
    const url = mockPush.mock.calls[0][0] as string;
    expect(url).toContain('/(tabs)/coach');
    expect(url).toContain('focus=mesocycle-analyst');
    expect(url).toContain('prefill=');
  });

  it('exposes accessible labels on the primary CTAs', async () => {
    mockSendCoachPrompt.mockResolvedValueOnce({
      role: 'assistant',
      content: 'Keep going.',
    });
    const { getByTestId } = render(<FormMesocycleModal />);
    await act(async () => {
      fireEvent.press(getByTestId('form-mesocycle-ask-coach'));
    });
    await waitFor(() => {
      expect(getByTestId('form-mesocycle-analyst-result')).toBeTruthy();
    });
    expect(
      getByTestId('form-mesocycle-analyst-continue-chat').props.accessibilityLabel,
    ).toBe('Continue this review in the coach chat');
    expect(
      getByTestId('form-mesocycle-analyst-regenerate').props.accessibilityLabel,
    ).toBe('Regenerate analyst review');
  });
});
