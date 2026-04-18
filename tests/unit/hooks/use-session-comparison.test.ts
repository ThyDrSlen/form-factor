import { act, renderHook, waitFor } from '@testing-library/react-native';
import {
  useSessionComparison,
  useSessionComparisonQuery,
} from '@/hooks/use-session-comparison';
import type { ExerciseSessionSummary } from '@/lib/services/session-comparison-aggregator';

function makeSummary(overrides: Partial<ExerciseSessionSummary> = {}): ExerciseSessionSummary {
  return {
    sessionId: overrides.sessionId ?? 'sess_curr',
    exerciseId: 'squat',
    completedAt: '2026-04-17T12:00:00Z',
    repCount: 5,
    avgFqi: 80,
    avgRomDeg: 105,
    avgDepthRatio: 0.9,
    avgSymmetryDeg: 4,
    faultCounts: {},
    ...overrides,
  };
}

describe('useSessionComparison (pure)', () => {
  it('returns null when current summary is null', () => {
    const { result } = renderHook(() => useSessionComparison(null, null));
    expect(result.current).toBeNull();
  });

  it('returns baseline comparison when only current exists', () => {
    const current = makeSummary();
    const { result } = renderHook(() => useSessionComparison(current, null));
    expect(result.current?.overallTrend).toBe('baseline');
  });

  it('memoizes the result when inputs are stable', () => {
    const current = makeSummary();
    const prior = makeSummary({ sessionId: 'sess_prev', avgFqi: 70 });
    const { result, rerender } = renderHook(
      ({ c, p }: { c: ExerciseSessionSummary; p: ExerciseSessionSummary }) =>
        useSessionComparison(c, p),
      { initialProps: { c: current, p: prior } },
    );
    const first = result.current;
    rerender({ c: current, p: prior });
    expect(result.current).toBe(first);
  });
});

describe('useSessionComparisonQuery', () => {
  it('does not call fetcher when params are incomplete', async () => {
    const fetcher = jest.fn();
    const { result } = renderHook(() =>
      useSessionComparisonQuery({
        currentSessionId: null,
        exerciseId: 'squat',
        userId: 'user_1',
        fetcher,
      }),
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.comparison).toBeNull();
  });

  it('loads summaries and computes comparison', async () => {
    const current = makeSummary({ sessionId: 'sess_curr', avgFqi: 85 });
    const prior = makeSummary({ sessionId: 'sess_prev', avgFqi: 75 });
    const fetcher = jest.fn().mockResolvedValue({ current, prior });

    const { result } = renderHook(() =>
      useSessionComparisonQuery({
        currentSessionId: 'sess_curr',
        exerciseId: 'squat',
        userId: 'user_1',
        fetcher,
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetcher).toHaveBeenCalledWith({
      currentSessionId: 'sess_curr',
      exerciseId: 'squat',
      userId: 'user_1',
    });
    expect(result.current.comparison?.fqiDelta).toBe(10);
    expect(result.current.error).toBeNull();
  });

  it('captures fetcher errors', async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() =>
      useSessionComparisonQuery({
        currentSessionId: 'sess_curr',
        exerciseId: 'squat',
        userId: 'user_1',
        fetcher,
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('network down');
    expect(result.current.comparison).toBeNull();
  });

  it('reload() re-invokes fetcher and refreshes comparison', async () => {
    const first = { current: makeSummary({ avgFqi: 70 }), prior: null };
    const second = { current: makeSummary({ avgFqi: 85 }), prior: null };
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    const { result } = renderHook(() =>
      useSessionComparisonQuery({
        currentSessionId: 'sess_curr',
        exerciseId: 'squat',
        userId: 'user_1',
        fetcher,
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.comparison?.currentSummary.avgFqi).toBe(70);

    act(() => {
      result.current.reload();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.comparison?.currentSummary.avgFqi).toBe(85);
  });
});
