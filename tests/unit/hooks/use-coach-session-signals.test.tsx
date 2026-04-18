import { act, renderHook } from '@testing-library/react-native';
import { createRepQualityLog, type RepQualityEntry } from '@/lib/services/rep-quality-log';
import { useCoachSessionSignals } from '@/hooks/use-coach-session-signals';

function mkEntry(partial: Partial<RepQualityEntry> = {}): RepQualityEntry {
  return {
    sessionId: 's1',
    repIndex: partial.repIndex ?? 1,
    exercise: 'squat',
    ts: `2026-04-17T09:00:0${partial.repIndex ?? 1}.000Z`,
    fqi: 70,
    faults: [],
    ...partial,
  };
}

describe('useCoachSessionSignals', () => {
  it('returns an empty-session shape when the log has no entries', () => {
    const log = createRepQualityLog();
    const { result } = renderHook(() => useCoachSessionSignals({ log }));
    expect(result.current.totalReps).toBe(0);
    expect(result.current.fqiTrend).toBe('insufficient-data');
    expect(result.current.recentFaults).toEqual([]);
  });

  it('rebuilds signals when new entries are appended', () => {
    const log = createRepQualityLog();
    const { result } = renderHook(() => useCoachSessionSignals({ log }));
    act(() => {
      log.append(mkEntry({ repIndex: 1, fqi: 60, faults: ['forward_knee'] }));
      log.append(mkEntry({ repIndex: 2, fqi: 65, faults: ['forward_knee'] }));
      log.append(mkEntry({ repIndex: 3, fqi: 80, faults: [] }));
      log.append(mkEntry({ repIndex: 4, fqi: 85, faults: [] }));
    });
    expect(result.current.totalReps).toBe(4);
    expect(result.current.fqiTrend).toBe('improving');
    expect(result.current.faultFrequency).toEqual({ forward_knee: 2 });
  });

  it('filters by sessionId', () => {
    const log = createRepQualityLog();
    log.append(mkEntry({ sessionId: 'a', repIndex: 1 }));
    log.append(mkEntry({ sessionId: 'b', repIndex: 1 }));
    const { result } = renderHook(() => useCoachSessionSignals({ log, sessionId: 'a' }));
    expect(result.current.totalReps).toBe(1);
    expect(result.current.sessionId).toBe('a');
  });

  it('respects windowSize for recentFaults', () => {
    const log = createRepQualityLog();
    log.append(mkEntry({ repIndex: 1, faults: ['early'] }));
    log.append(mkEntry({ repIndex: 2, faults: [] }));
    log.append(mkEntry({ repIndex: 3, faults: [] }));
    log.append(mkEntry({ repIndex: 4, faults: [] }));
    log.append(mkEntry({ repIndex: 5, faults: ['late'] }));
    const { result } = renderHook(() => useCoachSessionSignals({ log, windowSize: 2 }));
    expect(result.current.recentFaults).toEqual(['late']);
  });

  it('memoizes signals between renders without log changes', () => {
    const log = createRepQualityLog();
    log.append(mkEntry({ repIndex: 1 }));
    const { result, rerender } = renderHook(() => useCoachSessionSignals({ log }));
    const first = result.current;
    rerender({});
    expect(result.current).toBe(first);
  });
});
