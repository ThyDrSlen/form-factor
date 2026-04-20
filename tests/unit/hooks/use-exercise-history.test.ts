/**
 * Unit tests for useExerciseHistory hook.
 */

import { renderHook, act, waitFor } from '@testing-library/react-native';

const mockGetSummary = jest.fn();

jest.mock('@/lib/services/exercise-history', () => {
  const actual = jest.requireActual('@/lib/services/exercise-history');
  return {
    ...actual,
    getExerciseHistorySummary: (...args: unknown[]) => mockGetSummary(...args),
  };
});

import { useExerciseHistory, resetExerciseHistoryCache } from '@/hooks/use-exercise-history';
import { EMPTY_EXERCISE_HISTORY } from '@/lib/services/exercise-history';

const sampleSummary = {
  lastSession: {
    sessionId: 'sess-1',
    endedAt: '2024-11-01T12:00:00.000Z',
    sets: 3,
    totalReps: 24,
    topWeightLb: 185,
    avgFqi: 82,
  },
  last5SessionsAvgFqi: 81.5,
  maxReps: 10,
  maxVolume: 2000,
};

beforeEach(() => {
  jest.clearAllMocks();
  resetExerciseHistoryCache();
  mockGetSummary.mockResolvedValue(sampleSummary);
});

describe('useExerciseHistory', () => {
  it('returns EMPTY summary when exerciseId is null', () => {
    const { result } = renderHook(() => useExerciseHistory(null));
    expect(result.current.summary).toEqual(EMPTY_EXERCISE_HISTORY);
    expect(result.current.isLoading).toBe(false);
    expect(mockGetSummary).not.toHaveBeenCalled();
  });

  it('loads summary for a given exerciseId and populates state', async () => {
    const { result } = renderHook(() => useExerciseHistory('ex-pullup'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.summary).toEqual(sampleSummary);
    expect(mockGetSummary).toHaveBeenCalledTimes(1);
    expect(mockGetSummary).toHaveBeenCalledWith('ex-pullup');
  });

  it('serves subsequent renders from cache without re-querying the service', async () => {
    const { result, unmount } = renderHook(() => useExerciseHistory('ex-bench'));
    await waitFor(() => expect(result.current.summary).toEqual(sampleSummary));
    unmount();

    // Second mount with same id — should NOT call the service again.
    const second = renderHook(() => useExerciseHistory('ex-bench'));
    await waitFor(() => expect(second.result.current.summary).toEqual(sampleSummary));
    expect(mockGetSummary).toHaveBeenCalledTimes(1);
  });

  it('refresh() forces a re-query even when cache is fresh', async () => {
    const { result } = renderHook(() => useExerciseHistory('ex-squat'));
    await waitFor(() => expect(result.current.summary).toEqual(sampleSummary));
    expect(mockGetSummary).toHaveBeenCalledTimes(1);

    const updated = { ...sampleSummary, maxReps: 12 };
    mockGetSummary.mockResolvedValueOnce(updated);

    await act(async () => {
      await result.current.refresh();
    });
    expect(mockGetSummary).toHaveBeenCalledTimes(2);
    expect(result.current.summary).toEqual(updated);
  });

  it('surfaces errors without clobbering previous data', async () => {
    const { result } = renderHook(() => useExerciseHistory('ex-deadlift'));
    await waitFor(() => expect(result.current.summary).toEqual(sampleSummary));

    mockGetSummary.mockRejectedValueOnce(new Error('boom'));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.summary).toEqual(sampleSummary);
  });
});
