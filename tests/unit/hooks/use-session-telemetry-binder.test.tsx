import { act, renderHook } from '@testing-library/react-native';

const mockLogSet = jest.fn();

jest.mock('@/lib/services/rep-logger', () => ({
  logSet: (...args: unknown[]) => mockLogSet(...args),
}));

jest.mock('@/lib/stores/session-runner', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { create } = require('zustand');

  const buildSet = (overrides = {}) => ({
    id: 'set-1',
    session_exercise_id: 'sx-1',
    sort_order: 0,
    set_type: 'normal',
    planned_reps: 5,
    planned_seconds: null,
    planned_weight: null,
    actual_reps: null,
    actual_seconds: null,
    actual_weight: null,
    started_at: null,
    completed_at: null,
    rest_target_seconds: null,
    rest_started_at: null,
    rest_completed_at: null,
    rest_skipped: false,
    tut_ms: null,
    tut_source: 'unknown',
    perceived_rpe: null,
    notes: null,
    created_at: '2026-04-17T00:00:00.000Z',
    updated_at: '2026-04-17T00:00:00.000Z',
    ...overrides,
  });

  const initial = {
    activeSession: { id: 'session-1', user_id: 'u-1' },
    exercises: [
      {
        id: 'sx-1',
        session_id: 'session-1',
        exercise_id: 'squat',
        sort_order: 0,
        notes: null,
        created_at: '2026-04-17T00:00:00.000Z',
        updated_at: '2026-04-17T00:00:00.000Z',
        exercise: {
          id: 'squat',
          name: 'Back Squat',
          category: 'legs',
          muscle_group: null,
          is_compound: true,
          is_timed: false,
          is_system: true,
          created_by: null,
          created_at: '2026-04-17T00:00:00.000Z',
          updated_at: '2026-04-17T00:00:00.000Z',
        },
      },
    ],
    sets: { 'sx-1': [buildSet()] },
  };

  // Types are intentionally loose here — jest.mock factories cannot reference
  // out-of-scope aliases without triggering the hoist-guard warning.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = create((set: any) => ({
    ...initial,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    completeSet: (setId: any) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set((state: any) => ({
        sets: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'sx-1': (state.sets['sx-1'] ?? []).map((row: any) =>
            row.id === setId
              ? {
                  ...row,
                  actual_reps: 5,
                  actual_weight: 225,
                  completed_at: '2026-04-17T00:05:00.000Z',
                }
              : row,
          ),
        },
      })),
    _reset: () => set(() => ({ sets: { 'sx-1': [buildSet()] } })),
  }));

  return { useSessionRunner: store };
});

import { useSessionRunner } from '@/lib/stores/session-runner';
import { useSessionTelemetryBinder } from '@/hooks/use-session-telemetry-binder';

type MockStoreState = {
  completeSet: (id: string) => void;
  _reset: () => void;
};

function store(): MockStoreState {
  return useSessionRunner.getState() as unknown as MockStoreState;
}

beforeEach(() => {
  mockLogSet.mockReset();
  mockLogSet.mockResolvedValue('telemetry-set-1');
  store()._reset();
});

describe('useSessionTelemetryBinder', () => {
  it('subscribes on mount and emits logSet when a set transitions to completed', async () => {
    renderHook(() => useSessionTelemetryBinder());

    await act(async () => {
      store().completeSet('set-1');
      await Promise.resolve();
    });

    expect(mockLogSet).toHaveBeenCalledTimes(1);
    expect(mockLogSet).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        exercise: 'Back Squat',
        repsCount: 5,
        loadValue: 225,
        loadUnit: 'lbs',
      }),
    );
  });

  it('does nothing when `enabled` is false', async () => {
    renderHook(() => useSessionTelemetryBinder({ enabled: false }));

    await act(async () => {
      store().completeSet('set-1');
      await Promise.resolve();
    });

    expect(mockLogSet).not.toHaveBeenCalled();
  });

  it('uses the injected logger override instead of rep-logger', async () => {
    const override = jest.fn().mockResolvedValue('override-id');
    renderHook(() => useSessionTelemetryBinder({ logger: override }));

    await act(async () => {
      store().completeSet('set-1');
      await Promise.resolve();
    });

    expect(override).toHaveBeenCalledTimes(1);
    expect(mockLogSet).not.toHaveBeenCalled();
  });

  it('unsubscribes on unmount to stop emitting completions', async () => {
    const { unmount } = renderHook(() => useSessionTelemetryBinder());
    unmount();

    await act(async () => {
      store().completeSet('set-1');
      await Promise.resolve();
    });

    expect(mockLogSet).not.toHaveBeenCalled();
  });
});
