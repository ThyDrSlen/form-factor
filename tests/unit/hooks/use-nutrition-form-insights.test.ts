const mockSupabaseFrom = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
  },
}));

jest.mock('@/contexts/FoodContext', () => ({
  useFood: jest.fn(),
}));

jest.mock('@/contexts/HealthKitContext', () => ({
  useHealthKit: jest.fn(),
}));

import { act, renderHook, waitFor } from '@testing-library/react-native';
import {
  __resetNutritionFormInsightsCacheForTests,
  useNutritionFormInsights,
} from '@/hooks/use-nutrition-form-insights';
import { useFood } from '@/contexts/FoodContext';
import { useHealthKit } from '@/contexts/HealthKitContext';

const mockUseFood = useFood as jest.MockedFunction<typeof useFood>;
const mockUseHealthKit = useHealthKit as jest.MockedFunction<typeof useHealthKit>;

function mkBuilder(data: unknown, error: unknown = null) {
  // Supabase fluent builder — enough methods for the hook's path.
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.order = chain;
  builder.in = chain;
  builder.limit = jest.fn(() => Promise.resolve({ data, error }));
  return builder;
}

describe('useNutritionFormInsights', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    __resetNutritionFormInsightsCacheForTests();
    mockSupabaseFrom.mockReset();
    mockUseFood.mockReset();
    mockUseHealthKit.mockReset();

    mockUseFood.mockReturnValue({
      foods: [
        {
          id: 'f1',
          name: 'chicken',
          calories: 400,
          protein: 40,
          carbs: 30,
          fat: 10,
          date: '2026-01-01T08:00:00.000Z',
        },
      ],
      addFood: jest.fn(),
      deleteFood: jest.fn(),
      refreshFoods: jest.fn(),
      loading: false,
      error: null,
      isSyncing: false,
    });

    mockUseHealthKit.mockReturnValue({
      walkingHeartRateAvgHistory: [],
    } as unknown as ReturnType<typeof useHealthKit>);
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('starts loading and resolves with correlator output on success', async () => {
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'session_metrics') {
        return mkBuilder([
          { session_id: 's1', start_at: '2026-01-01T09:00:00.000Z' },
          { session_id: 's2', start_at: '2026-01-02T09:00:00.000Z' },
        ]);
      }
      if (table === 'reps') {
        return mkBuilder([
          { session_id: 's1', fqi: 85 },
          { session_id: 's1', fqi: 82 },
          { session_id: 's2', fqi: 70 },
        ]);
      }
      return mkBuilder([], null);
    });

    const { result } = renderHook(() => useNutritionFormInsights());
    expect(result.current.loading).toBe(true);

    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.sessions.length).toBe(2);
    expect(result.current.sessions[0].avgFqi).not.toBeNull();
    expect(result.current.nutrition).not.toBeNull();
    expect(result.current.recovery).not.toBeNull();
  });

  it('captures errors from supabase and exposes them on state', async () => {
    mockSupabaseFrom.mockImplementation(() =>
      mkBuilder(null, new Error('network down')),
    );

    const { result } = renderHook(() => useNutritionFormInsights());

    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('network down');
    expect(result.current.sessions).toEqual([]);
    expect(result.current.nutrition).toBeNull();
  });

  it('reuses cached sessions on remount within the TTL', async () => {
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'session_metrics') {
        return mkBuilder([
          { session_id: 's1', start_at: '2026-01-01T09:00:00.000Z' },
        ]);
      }
      return mkBuilder([{ session_id: 's1', fqi: 80 }]);
    });

    const first = renderHook(() => useNutritionFormInsights());
    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
    });
    await waitFor(() => expect(first.result.current.loading).toBe(false));

    const callsAfterFirst = mockSupabaseFrom.mock.calls.length;

    // Remount — cache should prevent a fresh fetch within TTL.
    const second = renderHook(() => useNutritionFormInsights());
    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
    });
    await waitFor(() => expect(second.result.current.loading).toBe(false));

    expect(second.result.current.sessions.length).toBe(1);
    // No additional from('session_metrics') call — cache hit path.
    expect(mockSupabaseFrom.mock.calls.length).toBe(callsAfterFirst);
  });

  it('refresh() bypasses the cache', async () => {
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'session_metrics') {
        return mkBuilder([
          { session_id: 's1', start_at: '2026-01-01T09:00:00.000Z' },
        ]);
      }
      return mkBuilder([{ session_id: 's1', fqi: 80 }]);
    });

    const { result } = renderHook(() => useNutritionFormInsights());
    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const firstCount = mockSupabaseFrom.mock.calls.length;

    await act(async () => {
      await result.current.refresh();
    });
    expect(mockSupabaseFrom.mock.calls.length).toBeGreaterThan(firstCount);
  });
});
