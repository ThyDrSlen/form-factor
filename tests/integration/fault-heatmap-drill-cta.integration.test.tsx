/**
 * Integration test: fault-heatmap drill CTA → coach-drill-explainer.
 *
 * Verifies the full wiring from the heatmap modal down to the drill
 * explainer service: mocks supabase so `loadFaultHeatmapData` returns
 * a realistic fault distribution, mocks `explainDrill` so we can
 * assert on the call payload, then drives the CTA tap and checks
 * that the top-N persistent faults all reach the explainer with the
 * drill-input shape the service expects.
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockBack = jest.fn();
const mockSupabaseFrom = jest.fn();
const mockExplainDrill = jest.fn();

jest.mock('expo-router', () => {
  const { View } = jest.requireActual('react-native');
  return {
    useRouter: () => ({ back: mockBack, push: jest.fn() }),
    Stack: { Screen: (props: { children?: React.ReactNode }) => <View>{props.children ?? null}</View> },
  };
});

jest.mock('@expo/vector-icons', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    Ionicons: (props: { name: string }) => <Text>{props.name}</Text>,
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
    auth: {
      onAuthStateChange: jest.fn(() => ({
        data: { subscription: { unsubscribe: jest.fn() } },
      })),
    },
  },
}));

jest.mock('@/lib/services/coach-drill-explainer', () => ({
  explainDrill: (...args: unknown[]) => mockExplainDrill(...args),
}));

import { FAULT_DRILL_GEMMA_FLAG_ENV_VAR } from '@/lib/services/fault-drill-gemma-flag';

function mkBuilder(data: unknown, error: unknown = null) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.order = chain;
  builder.gte = chain;
  builder.in = chain;
  builder.limit = jest.fn(() => Promise.resolve({ data, error }));
  return builder;
}

const TODAY = '2026-04-20';
const YESTERDAY = '2026-04-19';
const THREE_DAYS_AGO = '2026-04-17';

const FLAG_ORIGINAL = process.env[FAULT_DRILL_GEMMA_FLAG_ENV_VAR];

describe('fault-heatmap drill CTA → drill-explainer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(`${TODAY}T12:00:00.000Z`));
    mockBack.mockReset();
    mockSupabaseFrom.mockReset();
    mockExplainDrill.mockReset();

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'session_metrics') {
        return mkBuilder(
          [
            { session_id: 's-today', start_at: `${TODAY}T09:00:00.000Z` },
            { session_id: 's-yesterday', start_at: `${YESTERDAY}T09:00:00.000Z` },
            { session_id: 's-three', start_at: `${THREE_DAYS_AGO}T09:00:00.000Z` },
          ],
          null,
        );
      }
      if (table === 'reps') {
        return mkBuilder(
          [
            // Most frequent: knees_in × 5
            {
              session_id: 's-today',
              faults_detected: ['knees_in', 'knees_in'],
              start_ts: `${TODAY}T09:01:00.000Z`,
            },
            {
              session_id: 's-yesterday',
              faults_detected: ['knees_in', 'knees_in', 'knees_in'],
              start_ts: `${YESTERDAY}T09:01:00.000Z`,
            },
            // Second: shallow_depth × 3
            {
              session_id: 's-today',
              faults_detected: ['shallow_depth'],
              start_ts: `${TODAY}T09:02:00.000Z`,
            },
            {
              session_id: 's-yesterday',
              faults_detected: ['shallow_depth'],
              start_ts: `${YESTERDAY}T09:02:00.000Z`,
            },
            {
              session_id: 's-three',
              faults_detected: ['shallow_depth'],
              start_ts: `${THREE_DAYS_AGO}T09:01:00.000Z`,
            },
            // Third: forward_lean × 2
            {
              session_id: 's-today',
              faults_detected: ['forward_lean'],
              start_ts: `${TODAY}T09:03:00.000Z`,
            },
            {
              session_id: 's-yesterday',
              faults_detected: ['forward_lean'],
              start_ts: `${YESTERDAY}T09:03:00.000Z`,
            },
            // Below minCount — should be filtered out
            {
              session_id: 's-today',
              faults_detected: ['noise'],
              start_ts: `${TODAY}T09:04:00.000Z`,
            },
          ],
          null,
        );
      }
      return mkBuilder([], null);
    });
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    if (FLAG_ORIGINAL === undefined) {
      delete process.env[FAULT_DRILL_GEMMA_FLAG_ENV_VAR];
    } else {
      process.env[FAULT_DRILL_GEMMA_FLAG_ENV_VAR] = FLAG_ORIGINAL;
    }
  });

  it('does not render the CTA when the flag is off', async () => {
    delete process.env[FAULT_DRILL_GEMMA_FLAG_ENV_VAR];
    const FaultHeatmapModal = require('@/app/(modals)/fault-heatmap').default;

    const { queryByTestId, findByText } = render(<FaultHeatmapModal />);
    await findByText('Fault heatmap');
    expect(queryByTestId('fault-heatmap-ask-gemma')).toBeNull();
    expect(mockExplainDrill).not.toHaveBeenCalled();
  });

  it('fires explainDrill for each top-N fault when CTA tapped', async () => {
    process.env[FAULT_DRILL_GEMMA_FLAG_ENV_VAR] = '1';
    mockExplainDrill.mockImplementation(async () => ({
      explanation: 'Fix it like this',
      provider: 'cloud',
    }));

    jest.isolateModules(() => {});
    const FaultHeatmapModal = require('@/app/(modals)/fault-heatmap').default;

    const { findByTestId, getByTestId } = render(<FaultHeatmapModal />);

    // Wait for the CTA to appear (snapshot loads via supabase mock).
    const cta = await findByTestId('fault-heatmap-ask-gemma');
    expect(cta).toBeTruthy();

    await act(async () => {
      fireEvent.press(cta);
    });

    await waitFor(() => expect(mockExplainDrill).toHaveBeenCalledTimes(3));

    const faultCodesInCalls = mockExplainDrill.mock.calls.map(
      ([input]) => input.faults[0].code,
    );
    expect(new Set(faultCodesInCalls)).toEqual(
      new Set(['knees_in', 'shallow_depth', 'forward_lean']),
    );

    // Every call carries one DrillFaultInput with the expected shape.
    for (const [input] of mockExplainDrill.mock.calls) {
      expect(input.faults).toHaveLength(1);
      expect(input.faults[0]).toEqual(
        expect.objectContaining({
          code: expect.any(String),
          displayName: expect.any(String),
          count: expect.any(Number),
          severity: expect.any(Number),
        }),
      );
      expect(input.drillTitle).toBe('Targeted form drill');
      expect(input.drillCategory).toBe('technique');
      expect(typeof input.drillWhy).toBe('string');
      expect(input.exerciseId).toBe('form-tracking');
    }

    // 'noise' (count=1) is below the default minCount=2 and should NOT
    // have been sent to the explainer.
    expect(faultCodesInCalls).not.toContain('noise');

    // Drill sheet renders each result inline.
    await waitFor(() => getByTestId('fault-heatmap-drill-sheet'));
    for (const code of ['knees_in', 'shallow_depth', 'forward_lean']) {
      expect(getByTestId(`fault-heatmap-drill-${code}`)).toBeTruthy();
    }
  });
});
