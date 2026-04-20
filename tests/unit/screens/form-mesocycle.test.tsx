import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockRouter = { push: mockPush, back: mockBack, replace: jest.fn(), setParams: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
}));

const mockRefresh = jest.fn(async () => {});
const mockUseFormMesocycle = jest.fn();
jest.mock('@/hooks/use-form-mesocycle', () => ({
  useFormMesocycle: () => mockUseFormMesocycle(),
}));

import FormMesocycleModal from '@/app/(modals)/form-mesocycle';
import type { MesocycleInsights } from '@/lib/services/form-mesocycle-aggregator';

function insights(overrides: Partial<MesocycleInsights> = {}): MesocycleInsights {
  return {
    referenceIso: '2026-04-17T00:00:00.000Z',
    weeks: [
      { weekStartIso: '2026-03-23', weekIndex: 0, avgFqi: 70, sessionsCount: 1, repsCount: 10, setsCount: 2 },
      { weekStartIso: '2026-03-30', weekIndex: 1, avgFqi: 75, sessionsCount: 2, repsCount: 20, setsCount: 4 },
      { weekStartIso: '2026-04-06', weekIndex: 2, avgFqi: 80, sessionsCount: 2, repsCount: 22, setsCount: 5 },
      { weekStartIso: '2026-04-13', weekIndex: 3, avgFqi: 82, sessionsCount: 3, repsCount: 28, setsCount: 6 },
    ],
    topFaults: [
      { fault: 'valgus', count: 9, share: 0.11 },
      { fault: 'hips_rise', count: 4, share: 0.05 },
    ],
    deload: { severity: 'watch', fqiDelta: -6, faultDelta: 0.1, reason: 'Form quality is trending down.' },
    isEmpty: false,
    ...overrides,
  };
}

beforeEach(() => {
  mockPush.mockReset();
  mockBack.mockReset();
  mockRefresh.mockReset();
  mockUseFormMesocycle.mockReset();
});

describe('FormMesocycleModal', () => {
  it('renders loading state when the hook is still loading and no data is cached', () => {
    mockUseFormMesocycle.mockReturnValue({
      loading: true,
      error: null,
      insights: null,
      refresh: mockRefresh,
    });
    const { getByTestId } = render(<FormMesocycleModal />);
    expect(getByTestId('form-mesocycle-modal')).toBeTruthy();
    expect(getByTestId('form-mesocycle-card-loading')).toBeTruthy();
  });

  it('renders an empty-state card and hides Ask-coach CTA when isEmpty is true', () => {
    mockUseFormMesocycle.mockReturnValue({
      loading: false,
      error: null,
      insights: insights({ isEmpty: true, topFaults: [] }),
      refresh: mockRefresh,
    });
    const { getByTestId, queryByTestId } = render(<FormMesocycleModal />);
    expect(getByTestId('form-mesocycle-card-empty')).toBeTruthy();
    expect(queryByTestId('form-mesocycle-ask-coach')).toBeNull();
  });

  it('renders the full breakdown when data is present', () => {
    mockUseFormMesocycle.mockReturnValue({
      loading: false,
      error: null,
      insights: insights(),
      refresh: mockRefresh,
    });
    const { getByTestId } = render(<FormMesocycleModal />);
    expect(getByTestId('form-mesocycle-week-0')).toBeTruthy();
    expect(getByTestId('form-mesocycle-week-3')).toBeTruthy();
    expect(getByTestId('form-mesocycle-fault-valgus')).toBeTruthy();
    expect(getByTestId('form-mesocycle-fqi-delta')).toBeTruthy();
    expect(getByTestId('form-mesocycle-fault-delta')).toBeTruthy();
  });

  it('surfaces the error banner when the hook returns an error', () => {
    mockUseFormMesocycle.mockReturnValue({
      loading: false,
      error: 'no auth',
      insights: null,
      refresh: mockRefresh,
    });
    const { getByTestId, getByText } = render(<FormMesocycleModal />);
    expect(getByTestId('form-mesocycle-error')).toBeTruthy();
    expect(getByText('no auth')).toBeTruthy();
  });

  it('dismisses the modal when the close button is pressed', () => {
    mockUseFormMesocycle.mockReturnValue({
      loading: false,
      error: null,
      insights: insights(),
      refresh: mockRefresh,
    });
    const { getByTestId } = render(<FormMesocycleModal />);
    fireEvent.press(getByTestId('form-mesocycle-close'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('routes to /coach with the analyst prompt when Ask-coach is tapped', async () => {
    mockUseFormMesocycle.mockReturnValue({
      loading: false,
      error: null,
      insights: insights(),
      refresh: mockRefresh,
    });
    const { getByTestId } = render(<FormMesocycleModal />);
    fireEvent.press(getByTestId('form-mesocycle-ask-coach'));
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledTimes(1);
    });
    const url = mockPush.mock.calls[0][0] as string;
    expect(url).toMatch(/\/\(tabs\)\/coach\?prefill=/);
    expect(url).toMatch(/focus=mesocycle-analyst/);
    // The prompt is URL-encoded — decode and check the natural-language hint landed.
    expect(decodeURIComponent(url)).toMatch(/4 weeks of form tracking/);
  });
});
