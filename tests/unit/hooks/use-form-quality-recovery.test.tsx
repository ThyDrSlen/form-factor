import { renderHook, act, waitFor } from '@testing-library/react-native';

const mockGetSessionFaults = jest.fn();
const mockGetSessionAggregates = jest.fn();
const mockPrescribeDrills = jest.fn();
const mockExplainDrill = jest.fn();

jest.mock('@/lib/services/form-tracking-fault-reporter', () => ({
  getSessionFaults: (...args: unknown[]) => mockGetSessionFaults(...args),
  getSessionAggregates: (...args: unknown[]) => mockGetSessionAggregates(...args),
}));

jest.mock('@/lib/services/form-quality-recovery', () => ({
  prescribeDrills: (...args: unknown[]) => mockPrescribeDrills(...args),
}));

jest.mock('@/lib/services/coach-drill-explainer', () => ({
  explainDrill: (...args: unknown[]) => mockExplainDrill(...args),
}));

import { useFormQualityRecovery } from '@/hooks/use-form-quality-recovery';

const SAMPLE_PRESCRIPTIONS = [
  {
    drill: {
      id: 'tempo-squat-320',
      title: 'Tempo squat',
      category: 'technique',
      durationSec: 180,
      steps: ['step1'],
      why: 'because',
      targetFaults: ['shallow_depth'],
    },
    reason: '3 reps with moderate Shallow Depth',
    priority: 1,
    targetFaults: [
      { faultCode: 'shallow_depth', count: 3, maxSeverity: 2 },
    ],
  },
];

const SAMPLE_AGGREGATES = [
  {
    sessionId: 's1',
    exerciseId: 'squat',
    totalFaults: 3,
    byFaultCode: { shallow_depth: 3 },
    maxSeverity: 2,
  },
];

describe('useFormQualityRecovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSessionFaults.mockResolvedValue([
      { id: '1', sessionId: 's1', exerciseId: 'squat', faultCode: 'shallow_depth', severity: 2, timestamp: 1 },
    ]);
    mockGetSessionAggregates.mockResolvedValue(SAMPLE_AGGREGATES);
    mockPrescribeDrills.mockReturnValue(SAMPLE_PRESCRIPTIONS);
    mockExplainDrill.mockResolvedValue({ explanation: 'Do this because …', provider: 'cloud' });
  });

  it('loads prescriptions and summary for a sessionId', async () => {
    const { result } = renderHook(() => useFormQualityRecovery('s1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.prescriptions).toEqual(SAMPLE_PRESCRIPTIONS);
    expect(result.current.summary?.sessionId).toBe('s1');
    expect(result.current.summary?.totalFaults).toBe(1);
    expect(result.current.summary?.exerciseCount).toBe(1);
    expect(result.current.error).toBeNull();
    expect(mockPrescribeDrills).toHaveBeenCalledTimes(1);
  });

  it('clears state when sessionId is null', async () => {
    const { result } = renderHook(() => useFormQualityRecovery(null));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.prescriptions).toEqual([]);
    expect(result.current.summary).toBeNull();
    expect(mockGetSessionFaults).not.toHaveBeenCalled();
  });

  it('clears state when sessionId is undefined', async () => {
    const { result } = renderHook(() => useFormQualityRecovery(undefined));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.prescriptions).toEqual([]);
    expect(result.current.summary).toBeNull();
  });

  it('reports error when fault load rejects', async () => {
    mockGetSessionFaults.mockRejectedValueOnce(new Error('SQLite dead'));
    const { result } = renderHook(() => useFormQualityRecovery('s1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe('SQLite dead');
    expect(result.current.prescriptions).toEqual([]);
    expect(result.current.summary).toBeNull();
  });

  it('reloads faults on refresh()', async () => {
    const { result } = renderHook(() => useFormQualityRecovery('s1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    mockGetSessionFaults.mockClear();
    mockGetSessionAggregates.mockClear();
    mockPrescribeDrills.mockClear();
    await act(async () => {
      await result.current.refresh();
    });
    expect(mockGetSessionFaults).toHaveBeenCalledTimes(1);
    expect(mockPrescribeDrills).toHaveBeenCalledTimes(1);
  });

  it('caches per-drill explanation state under drillId', async () => {
    const { result } = renderHook(() => useFormQualityRecovery('s1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.requestExplanation('tempo-squat-320', {
        drillTitle: 'Tempo squat',
        drillCategory: 'technique',
        drillWhy: 'because',
        exerciseId: 'squat',
        faults: [{ code: 'shallow_depth', count: 3, severity: 2 }],
      });
    });
    const state = result.current.explanations['tempo-squat-320'];
    expect(state).toBeDefined();
    expect(state.isLoading).toBe(false);
    expect(state.result?.explanation).toBe('Do this because …');
  });

  it('flips explanation state to loading while the call is in flight', async () => {
    const { result } = renderHook(() => useFormQualityRecovery('s1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let resolveExplain: (value: { explanation: string; provider: string }) => void = () => {};
    mockExplainDrill.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveExplain = resolve;
        })
    );

    let pending: Promise<void>;
    act(() => {
      pending = result.current.requestExplanation('d1', {
        drillTitle: 't',
        drillCategory: 'c',
        drillWhy: 'w',
        exerciseId: 'x',
        faults: [],
      });
    });
    await waitFor(() => expect(result.current.explanations.d1?.isLoading).toBe(true));
    await act(async () => {
      resolveExplain({ explanation: 'done', provider: 'cloud' });
      await pending;
    });
    expect(result.current.explanations.d1?.isLoading).toBe(false);
    expect(result.current.explanations.d1?.result?.explanation).toBe('done');
  });

  it('does not set state after unmount (mountedRef guard)', async () => {
    let deferredResolve: (value: unknown) => void = () => {};
    mockGetSessionFaults.mockImplementationOnce(
      () => new Promise((resolve) => {
        deferredResolve = resolve;
      })
    );
    const { result, unmount } = renderHook(() => useFormQualityRecovery('s1'));
    expect(result.current.isLoading).toBe(true);
    unmount();
    deferredResolve([]);
    // wait a tick — if setState fires after unmount, it'd throw a jest "act"
    // warning, which would fail this test.
    await new Promise((r) => setTimeout(r, 10));
  });

  it('drops stale response when sessionId changes mid-flight', async () => {
    // Arrange: first fetch for s1 is slow; second fetch for s2 resolves
    // via the default mock (immediately). The s1 response must not
    // clobber the s2 state once it finally comes back.
    let resolveS1Faults: (value: unknown) => void = () => {};
    let resolveS1Aggregates: (value: unknown) => void = () => {};
    mockGetSessionFaults.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveS1Faults = resolve;
      })
    );
    mockGetSessionAggregates.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveS1Aggregates = resolve;
      })
    );

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useFormQualityRecovery(id),
      { initialProps: { id: 's1' } }
    );
    expect(result.current.isLoading).toBe(true);

    // Swap to s2 before s1 resolves. s2 uses the baseline resolved mocks
    // so it completes on its own immediately.
    rerender({ id: 's2' });
    await waitFor(() => expect(result.current.summary?.sessionId).toBe('s2'));
    expect(result.current.isLoading).toBe(false);

    // Now belatedly resolve s1 — the hook should ignore this stale reply
    // rather than overwrite the s2 summary or flip isLoading back on.
    await act(async () => {
      resolveS1Faults([
        { id: 'stale', sessionId: 's1', exerciseId: 'squat', faultCode: 'shallow_depth', severity: 1, timestamp: 0 },
      ]);
      resolveS1Aggregates([]);
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.summary?.sessionId).toBe('s2');
  });
});
