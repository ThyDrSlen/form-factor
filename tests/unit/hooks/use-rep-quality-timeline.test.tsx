import { act, renderHook } from '@testing-library/react-native';
import { createRepQualityLog, type RepQualityEntry } from '@/lib/services/rep-quality-log';
import { useRepQualityTimeline } from '@/hooks/use-rep-quality-timeline';

function mkEntry(partial: Partial<RepQualityEntry> = {}): RepQualityEntry {
  return {
    sessionId: 's1',
    repIndex: partial.repIndex ?? 1,
    exercise: 'squat',
    ts: `2026-04-17T09:00:0${partial.repIndex ?? 1}.000Z`,
    fqi: 80,
    faults: [],
    ...partial,
  };
}

describe('useRepQualityTimeline', () => {
  it('returns an empty timeline when the log is empty', () => {
    const log = createRepQualityLog();
    const { result } = renderHook(() => useRepQualityTimeline({ log }));
    expect(result.current.summary.totalReps).toBe(0);
    expect(result.current.segments).toHaveLength(0);
  });

  it('rebuilds the timeline when entries are appended', () => {
    const log = createRepQualityLog();
    const { result } = renderHook(() => useRepQualityTimeline({ log }));
    act(() => {
      log.append(mkEntry({ repIndex: 1, fqi: 80 }));
      log.append(mkEntry({ repIndex: 2, fqi: 90, faults: [] }));
    });
    expect(result.current.summary.totalReps).toBe(2);
    expect(result.current.summary.avgFqi).toBe(85);
  });

  it('filters by sessionId', () => {
    const log = createRepQualityLog();
    log.append(mkEntry({ sessionId: 'a', repIndex: 1, fqi: 60 }));
    log.append(mkEntry({ sessionId: 'b', repIndex: 1, fqi: 90 }));
    const { result } = renderHook(() => useRepQualityTimeline({ log, sessionId: 'a' }));
    expect(result.current.summary.totalReps).toBe(1);
    expect(result.current.summary.avgFqi).toBe(60);
  });

  it('respects threshold options', () => {
    const log = createRepQualityLog();
    log.append(mkEntry({ repIndex: 1, fqi: 75, faults: [] }));
    const { result } = renderHook(() =>
      useRepQualityTimeline({ log, highConfidenceFqi: 70 })
    );
    expect(result.current.segments.some((s) => s.type === 'high-confidence')).toBe(true);
  });

  it('memoizes the timeline object between renders without log changes', () => {
    const log = createRepQualityLog();
    log.append(mkEntry({ repIndex: 1 }));
    const { result, rerender } = renderHook(() => useRepQualityTimeline({ log }));
    const first = result.current;
    rerender({});
    expect(result.current).toBe(first);
  });
});
