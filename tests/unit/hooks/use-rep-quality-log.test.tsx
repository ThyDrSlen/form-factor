import { act, renderHook } from '@testing-library/react-native';
import { createRepQualityLog, type RepQualityEntry } from '@/lib/services/rep-quality-log';
import { useRepQualityLog } from '@/hooks/use-rep-quality-log';

function mkEntry(partial: Partial<RepQualityEntry> = {}): RepQualityEntry {
  return {
    sessionId: 's1',
    repIndex: partial.repIndex ?? 1,
    exercise: 'pullup',
    ts: `2026-04-17T09:00:0${partial.repIndex ?? 1}.000Z`,
    fqi: 80,
    faults: [],
    ...partial,
  };
}

describe('useRepQualityLog', () => {
  it('returns empty state when the log has no entries', () => {
    const log = createRepQualityLog();
    const { result } = renderHook(() => useRepQualityLog({ log }));
    expect(result.current.entries).toEqual([]);
    expect(result.current.latest).toBeNull();
    expect(result.current.size).toBe(0);
  });

  it('re-renders when a new entry is appended', () => {
    const log = createRepQualityLog();
    const { result } = renderHook(() => useRepQualityLog({ log }));
    act(() => {
      log.append(mkEntry({ repIndex: 1 }));
    });
    expect(result.current.size).toBe(1);
    expect(result.current.latest?.repIndex).toBe(1);
  });

  it('re-renders when the log is cleared', () => {
    const log = createRepQualityLog();
    log.append(mkEntry({ repIndex: 1 }));
    const { result } = renderHook(() => useRepQualityLog({ log }));
    expect(result.current.size).toBe(1);
    act(() => {
      log.clear();
    });
    expect(result.current.size).toBe(0);
    expect(result.current.latest).toBeNull();
  });

  it('filters entries by sessionId when provided', () => {
    const log = createRepQualityLog();
    log.append(mkEntry({ sessionId: 'a', repIndex: 1 }));
    log.append(mkEntry({ sessionId: 'b', repIndex: 1 }));
    const { result } = renderHook(() => useRepQualityLog({ log, sessionId: 'a' }));
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].sessionId).toBe('a');
    expect(result.current.latest?.sessionId).toBe('a');
  });

  it('unsubscribes on unmount so stale listeners are not left behind', () => {
    const log = createRepQualityLog();
    const originalSubscribe = log.subscribe.bind(log);
    const unsubscribes: jest.Mock[] = [];
    log.subscribe = (listener) => {
      const unsub = jest.fn(originalSubscribe(listener));
      unsubscribes.push(unsub);
      return unsub;
    };
    const { unmount } = renderHook(() => useRepQualityLog({ log }));
    unmount();
    expect(unsubscribes.some((u) => u.mock.calls.length > 0)).toBe(true);
  });
});
