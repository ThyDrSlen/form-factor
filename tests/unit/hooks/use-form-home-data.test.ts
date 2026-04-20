const mockSupabaseFrom = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
  },
}));

import { act, renderHook, waitFor } from '@testing-library/react-native';
import {
  __resetFormHomeDataCacheForTests,
  useFormHomeData,
} from '@/hooks/use-form-home-data';

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

const NOW_ISO = '2026-04-16T12:00:00.000Z';

describe('useFormHomeData', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(NOW_ISO));
    __resetFormHomeDataCacheForTests();
    mockSupabaseFrom.mockReset();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('renders empty state when there are no sessions', async () => {
    mockSupabaseFrom.mockImplementation(() => mkBuilder([], null));
    const { result } = renderHook(() => useFormHomeData());
    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.todayBestFqi).toBeNull();
    expect(result.current.data.trend).toEqual([]);
    expect(result.current.data.lastSessionId).toBeNull();
  });

  it('computes today + trend + faults from supabase rows', async () => {
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'session_metrics') {
        return mkBuilder([
          { session_id: 's-today', start_at: '2026-04-16T09:00:00.000Z' },
          { session_id: 's-yesterday', start_at: '2026-04-15T09:00:00.000Z' },
        ]);
      }
      if (table === 'reps') {
        return mkBuilder([
          {
            session_id: 's-today',
            fqi: 90,
            faults_detected: ['knees_in'],
            start_ts: '2026-04-16T09:01:00.000Z',
          },
          {
            session_id: 's-today',
            fqi: 82,
            faults_detected: ['knees_in', 'butt_wink'],
            start_ts: '2026-04-16T09:02:00.000Z',
          },
          {
            session_id: 's-yesterday',
            fqi: 70,
            faults_detected: ['elbow_flare'],
            start_ts: '2026-04-15T09:10:00.000Z',
          },
        ]);
      }
      return mkBuilder([]);
    });
    const { result } = renderHook(() => useFormHomeData());
    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.todayBestFqi).toBe(90);
    expect(result.current.data.todayAvgFqi).toBe(86);
    expect(result.current.data.todaySetCount).toBe(1);
    expect(result.current.data.trend.length).toBe(7);
    expect(result.current.data.allTimeAvg).not.toBeNull();
    expect(result.current.data.faultCells.length).toBeGreaterThan(0);
    expect(result.current.data.lastSessionId).toBe('s-today');
  });

  it('captures errors from the session_metrics query', async () => {
    mockSupabaseFrom.mockImplementation(() =>
      mkBuilder(null, new Error('db down')),
    );
    const { result } = renderHook(() => useFormHomeData());
    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('db down');
  });

  it('reuses cache on remount within TTL and bypasses it on refresh()', async () => {
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'session_metrics') {
        return mkBuilder([
          { session_id: 's1', start_at: '2026-04-16T09:00:00.000Z' },
        ]);
      }
      return mkBuilder([
        {
          session_id: 's1',
          fqi: 80,
          faults_detected: [],
          start_ts: '2026-04-16T09:00:00.000Z',
        },
      ]);
    });
    const first = renderHook(() => useFormHomeData());
    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
    });
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    const baseline = mockSupabaseFrom.mock.calls.length;

    const second = renderHook(() => useFormHomeData());
    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
    });
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(mockSupabaseFrom.mock.calls.length).toBe(baseline);

    await act(async () => {
      await second.result.current.refresh();
    });
    expect(mockSupabaseFrom.mock.calls.length).toBeGreaterThan(baseline);
  });
});
