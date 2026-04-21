import { act, renderHook, waitFor } from '@testing-library/react-native';

import { usePersistentFaultSummary } from '@/hooks/use-persistent-fault-summary';
import { FAULT_DRILL_GEMMA_FLAG_ENV_VAR } from '@/lib/services/fault-drill-gemma-flag';
import type { FaultHeatmapSnapshot } from '@/lib/services/fault-heatmap-data-loader';

const flagOriginal = process.env[FAULT_DRILL_GEMMA_FLAG_ENV_VAR];

function makeSnapshot(totals: { faultId: string; count: number }[]): FaultHeatmapSnapshot {
  return { cells: [], days: [], totals, lastSessionId: 's-1' };
}

describe('usePersistentFaultSummary', () => {
  afterEach(() => {
    if (flagOriginal === undefined) {
      delete process.env[FAULT_DRILL_GEMMA_FLAG_ENV_VAR];
    } else {
      process.env[FAULT_DRILL_GEMMA_FLAG_ENV_VAR] = flagOriginal;
    }
  });

  it('stays empty + not loading when flag is off', async () => {
    delete process.env[FAULT_DRILL_GEMMA_FLAG_ENV_VAR];
    const loader = jest.fn(() => Promise.resolve(makeSnapshot([{ faultId: 'knees_in', count: 5 }])));
    const { result } = renderHook(() => usePersistentFaultSummary({ loader }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(false);
    expect(result.current.topFaults).toEqual([]);
    // Flag-gated loaders never fire — fail-closed.
    expect(loader).not.toHaveBeenCalled();
  });

  it('runs the loader + aggregates when flag is on', async () => {
    process.env[FAULT_DRILL_GEMMA_FLAG_ENV_VAR] = '1';
    const loader = jest.fn(() =>
      Promise.resolve(
        makeSnapshot([
          { faultId: 'knees_in', count: 5 },
          { faultId: 'shallow_depth', count: 3 },
          { faultId: 'forward_lean', count: 2 },
          { faultId: 'noise', count: 1 },
        ]),
      ),
    );

    const { result } = renderHook(() => usePersistentFaultSummary({ loader }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(true);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(result.current.topFaults.map((f) => f.code)).toEqual([
      'knees_in',
      'shallow_depth',
      'forward_lean',
    ]);
    expect(result.current.snapshot?.lastSessionId).toBe('s-1');
  });

  it('surfaces loader errors', async () => {
    process.env[FAULT_DRILL_GEMMA_FLAG_ENV_VAR] = 'true';
    const loader = jest.fn(() => Promise.reject(new Error('net down')));
    const { result } = renderHook(() => usePersistentFaultSummary({ loader }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('net down');
    expect(result.current.topFaults).toEqual([]);
  });

  it('exposes refresh() which reruns the loader when enabled', async () => {
    process.env[FAULT_DRILL_GEMMA_FLAG_ENV_VAR] = '1';
    const loader = jest.fn(() => Promise.resolve(makeSnapshot([{ faultId: 'knees_in', count: 5 }])));
    const { result } = renderHook(() => usePersistentFaultSummary({ loader }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(loader).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.refresh();
      await Promise.resolve();
    });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('bypassFlag lets tests exercise the loader path regardless of env', async () => {
    delete process.env[FAULT_DRILL_GEMMA_FLAG_ENV_VAR];
    const loader = jest.fn(() => Promise.resolve(makeSnapshot([{ faultId: 'knees_in', count: 3 }])));
    const { result } = renderHook(() =>
      usePersistentFaultSummary({ loader, bypassFlag: true }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(true);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(result.current.topFaults.map((f) => f.code)).toEqual(['knees_in']);
  });
});
