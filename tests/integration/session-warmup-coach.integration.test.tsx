/**
 * Integration test: session-warmup-coach modal generates a plan.
 *
 * Mocks `warmup-generator.generateWarmup` (so no coach network
 * touches), mocks the local-db template lookup, renders the modal,
 * and verifies:
 *
 * - Flag off → "disabled" banner, generator never called.
 * - Flag on + valid sessionId → generator called with normalized input,
 *   plan renders with movement rows.
 * - Generator rejection → error card + Retry button.
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockBack = jest.fn();
const mockGenerateWarmup = jest.fn();

jest.mock('expo-router', () => {
  const { View } = jest.requireActual('react-native');
  return {
    useRouter: () => ({ back: mockBack, push: jest.fn() }),
    useLocalSearchParams: () => ({ sessionId: 'tmpl-123' }),
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
  SafeAreaView: ({ children }: { children: React.ReactNode }) => {
    const { View } = jest.requireActual('react-native');
    return <View>{children}</View>;
  },
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/lib/services/warmup-generator', () => ({
  generateWarmup: (...args: unknown[]) => mockGenerateWarmup(...args),
}));

const mockDbGetAllAsync = jest.fn();
jest.mock('@/lib/services/database/local-db', () => ({
  localDB: {
    get db() {
      return {
        getAllAsync: (...args: unknown[]) => mockDbGetAllAsync(...args),
      };
    },
  },
}));

import { WARMUP_COACH_FLAG_ENV_VAR } from '@/lib/services/warmup-coach-flag';

const FLAG_ORIGINAL = process.env[WARMUP_COACH_FLAG_ENV_VAR];

const FAKE_PLAN = {
  name: 'Squat day warmup',
  duration_min: 6,
  movements: [
    { name: 'Hip flow', focus: 'mobility', intensity: 'low', duration_seconds: 60 },
    { name: 'Goblet squat', focus: 'activation', intensity: 'medium', reps: 10 },
  ],
};

describe('session-warmup-coach modal generates plan', () => {
  beforeEach(() => {
    mockBack.mockReset();
    mockGenerateWarmup.mockReset();
    mockDbGetAllAsync.mockReset();

    mockDbGetAllAsync.mockImplementation((sql: string) => {
      if (sql.startsWith('SELECT id, name FROM workout_templates')) {
        return Promise.resolve([{ id: 'tmpl-123', name: 'Push day' }]);
      }
      if (sql.includes('FROM workout_template_exercises')) {
        return Promise.resolve([
          { exercise_name: 'Bench Press', sort_order: 0 },
          { exercise_name: 'Overhead Press', sort_order: 1 },
        ]);
      }
      return Promise.resolve([]);
    });
  });

  afterEach(() => {
    if (FLAG_ORIGINAL === undefined) {
      delete process.env[WARMUP_COACH_FLAG_ENV_VAR];
    } else {
      process.env[WARMUP_COACH_FLAG_ENV_VAR] = FLAG_ORIGINAL;
    }
  });

  it('shows the "disabled" banner and does NOT call the generator when the flag is off', async () => {
    delete process.env[WARMUP_COACH_FLAG_ENV_VAR];
    const SessionWarmupCoachScreen =
      require('@/app/(modals)/session-warmup-coach').default;

    const { getByTestId, queryByTestId } = render(<SessionWarmupCoachScreen />);

    await waitFor(() => getByTestId('session-warmup-flag-off'));
    expect(queryByTestId('session-warmup-plan')).toBeNull();
    expect(mockGenerateWarmup).not.toHaveBeenCalled();
  });

  it('renders the plan after generating when the flag is on', async () => {
    process.env[WARMUP_COACH_FLAG_ENV_VAR] = '1';
    mockGenerateWarmup.mockResolvedValue(FAKE_PLAN);

    const SessionWarmupCoachScreen =
      require('@/app/(modals)/session-warmup-coach').default;

    const { findByTestId, getByText, getByTestId } = render(<SessionWarmupCoachScreen />);

    // Session name resolves from the mocked local-db lookup.
    await findByTestId('session-warmup-session-name');
    expect(getByText('Push day')).toBeTruthy();

    // Generator auto-fires — wait for the plan block.
    await findByTestId('session-warmup-plan');
    expect(getByText('Squat day warmup')).toBeTruthy();
    expect(getByText('6 min warmup')).toBeTruthy();
    expect(getByTestId('session-warmup-movement-0')).toBeTruthy();
    expect(getByTestId('session-warmup-movement-1')).toBeTruthy();

    expect(mockGenerateWarmup).toHaveBeenCalledTimes(1);
    const [input] = mockGenerateWarmup.mock.calls[0];
    expect(input.exerciseSlugs).toEqual(['bench_press', 'overhead_press']);
  });

  it('surfaces an error card + retry when the generator rejects', async () => {
    process.env[WARMUP_COACH_FLAG_ENV_VAR] = 'true';
    mockGenerateWarmup.mockRejectedValueOnce(new Error('coach offline'));

    const SessionWarmupCoachScreen =
      require('@/app/(modals)/session-warmup-coach').default;

    const { findByTestId, getByText, getByTestId } = render(<SessionWarmupCoachScreen />);

    await findByTestId('session-warmup-error');
    expect(getByText('coach offline')).toBeTruthy();

    // Retry resolves this time — plan should render.
    mockGenerateWarmup.mockResolvedValueOnce(FAKE_PLAN);

    await act(async () => {
      fireEvent.press(getByTestId('session-warmup-retry'));
    });
    await findByTestId('session-warmup-plan');
    expect(mockGenerateWarmup).toHaveBeenCalledTimes(2);
  });
});
