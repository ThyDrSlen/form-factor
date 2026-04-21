/**
 * Pipeline-v2: tests AutoDebriefCard mount in the form-tracking debrief modal.
 * - Flag on + hook resolved → card rendered with brief content
 * - Flag off → card not in tree
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import FormTrackingDebriefScreen from '@/app/(modals)/form-tracking-debrief';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockParams: { current: Record<string, string | undefined> } = { current: {} };

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => mockParams.current,
}));

// Force the hook to return deterministic state so we can assert card visuals.
// Prefix with `mock` so jest's hoisting doesn't trip on out-of-scope names.
const mockUseAutoDebrief = jest.fn();
jest.mock('@/hooks/use-auto-debrief', () => ({
  useAutoDebrief: (opts: unknown) => mockUseAutoDebrief(opts),
}));

const FLAG = 'EXPO_PUBLIC_COACH_PIPELINE_V2';
const originalFlag = process.env[FLAG];

const sampleReps = [{ index: 1, fqi: 80, faults: [] }];

function setParams(next: Record<string, string | undefined>) {
  mockParams.current = next;
}

afterEach(() => {
  if (originalFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = originalFlag;
});

beforeEach(() => {
  jest.clearAllMocks();
  setParams({
    exerciseName: 'Squat',
    durationSeconds: '120',
    reps: JSON.stringify(sampleReps),
  });
});

describe('FormTrackingDebriefScreen AutoDebriefCard mount (pipeline-v2)', () => {
  it('renders AutoDebriefCard when flag is on and hook resolves data', () => {
    process.env[FLAG] = 'on';
    mockUseAutoDebrief.mockReturnValue({
      data: {
        sessionId: 'debrief:Squat:1:80',
        provider: 'openai',
        brief: 'Great tempo on squat today.',
        generatedAt: '2026-04-16T11:00:00Z',
      },
      loading: false,
      error: null,
      retry: jest.fn(),
    });

    const { getByTestId } = render(<FormTrackingDebriefScreen />);
    // Section wrapper and card result variant should both be in the tree.
    expect(getByTestId('form-tracking-debrief-auto-section')).toBeTruthy();
    expect(getByTestId('auto-debrief-result')).toBeTruthy();
  });

  it('does not render AutoDebriefCard when flag is off', () => {
    delete process.env[FLAG];
    mockUseAutoDebrief.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      retry: jest.fn(),
    });

    const { queryByTestId } = render(<FormTrackingDebriefScreen />);
    expect(queryByTestId('form-tracking-debrief-auto-section')).toBeNull();
    expect(queryByTestId('auto-debrief-result')).toBeNull();
    expect(queryByTestId('auto-debrief-loading')).toBeNull();
  });
});
