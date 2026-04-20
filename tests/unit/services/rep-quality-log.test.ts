import { createRepQualityLog, defaultRepQualityLog, type RepQualityEntry } from '@/lib/services/rep-quality-log';

function mkEntry(partial: Partial<RepQualityEntry> = {}): RepQualityEntry {
  return {
    sessionId: 's1',
    repIndex: 1,
    exercise: 'pullup',
    ts: new Date(2026, 3, 17, 9, 0, 0).toISOString(),
    fqi: 82,
    faults: [],
    ...partial,
  };
}

describe('rep-quality-log', () => {
  describe('createRepQualityLog', () => {
    it('appends entries and reports size', () => {
      const log = createRepQualityLog();
      expect(log.size()).toBe(0);
      log.append(mkEntry());
      log.append(mkEntry({ repIndex: 2 }));
      expect(log.size()).toBe(2);
    });

    it('returns copies so mutating the returned entries cannot corrupt the log', () => {
      const log = createRepQualityLog();
      log.append(mkEntry({ faults: ['forward_knee'] }));
      const entries = log.entries();
      entries[0].faults.push('corrupt');
      entries[0].repIndex = 9999;
      expect(log.entries()[0].faults).toEqual(['forward_knee']);
      expect(log.entries()[0].repIndex).toBe(1);
    });

    it('returns a defensive copy of faultSeverity', () => {
      const log = createRepQualityLog();
      log.append(mkEntry({ faultSeverity: { forward_knee: 10 } }));
      const entry = log.entries()[0];
      if (entry.faultSeverity) {
        entry.faultSeverity.forward_knee = 9999;
      }
      const again = log.entries()[0];
      expect(again.faultSeverity).toEqual({ forward_knee: 10 });
    });

    it('filters entries by sessionId', () => {
      const log = createRepQualityLog();
      log.append(mkEntry({ sessionId: 'a', repIndex: 1 }));
      log.append(mkEntry({ sessionId: 'b', repIndex: 1 }));
      log.append(mkEntry({ sessionId: 'a', repIndex: 2 }));
      expect(log.entries('a').map((e) => e.repIndex)).toEqual([1, 2]);
      expect(log.entries('b')).toHaveLength(1);
      expect(log.entries()).toHaveLength(3);
    });

    it('latest returns the most recent entry, filtered by session when provided', () => {
      const log = createRepQualityLog();
      log.append(mkEntry({ sessionId: 'a', repIndex: 1 }));
      log.append(mkEntry({ sessionId: 'b', repIndex: 1 }));
      log.append(mkEntry({ sessionId: 'a', repIndex: 2, fqi: 91 }));
      expect(log.latest('a')?.fqi).toBe(91);
      expect(log.latest('b')?.sessionId).toBe('b');
      expect(log.latest()?.repIndex).toBe(2);
    });

    it('latest returns null on empty log', () => {
      const log = createRepQualityLog();
      expect(log.latest()).toBeNull();
      expect(log.latest('missing')).toBeNull();
    });

    it('clear wipes every entry when no session is given', () => {
      const log = createRepQualityLog();
      log.append(mkEntry({ sessionId: 'a' }));
      log.append(mkEntry({ sessionId: 'b' }));
      log.clear();
      expect(log.size()).toBe(0);
    });

    it('clear with a sessionId wipes only that session', () => {
      const log = createRepQualityLog();
      log.append(mkEntry({ sessionId: 'a', repIndex: 1 }));
      log.append(mkEntry({ sessionId: 'b', repIndex: 1 }));
      log.append(mkEntry({ sessionId: 'a', repIndex: 2 }));
      log.clear('a');
      expect(log.size()).toBe(1);
      expect(log.entries()[0].sessionId).toBe('b');
    });

    it('enforces maxEntries by dropping oldest entries first', () => {
      const log = createRepQualityLog({ maxEntries: 3 });
      for (let i = 1; i <= 5; i++) {
        log.append(mkEntry({ repIndex: i }));
      }
      expect(log.size()).toBe(3);
      expect(log.entries().map((e) => e.repIndex)).toEqual([3, 4, 5]);
    });

    it('clamps maxEntries to at least 1', () => {
      const log = createRepQualityLog({ maxEntries: 0 });
      log.append(mkEntry({ repIndex: 1 }));
      log.append(mkEntry({ repIndex: 2 }));
      expect(log.size()).toBe(1);
      expect(log.entries()[0].repIndex).toBe(2);
    });
  });

  describe('subscribe', () => {
    it('fires the listener on append', () => {
      const log = createRepQualityLog();
      const listener = jest.fn();
      log.subscribe(listener);
      log.append(mkEntry());
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('fires the listener on clear', () => {
      const log = createRepQualityLog();
      log.append(mkEntry());
      const listener = jest.fn();
      log.subscribe(listener);
      log.clear();
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('fires the listener on session-scoped clear', () => {
      const log = createRepQualityLog();
      const listener = jest.fn();
      log.subscribe(listener);
      log.clear('any');
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('returns an unsubscribe function that stops further calls', () => {
      const log = createRepQualityLog();
      const listener = jest.fn();
      const unsub = log.subscribe(listener);
      log.append(mkEntry());
      unsub();
      log.append(mkEntry({ repIndex: 2 }));
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('isolates a thrown listener so other listeners still run', () => {
      const log = createRepQualityLog();
      const bad = jest.fn(() => {
        throw new Error('boom');
      });
      const good = jest.fn();
      log.subscribe(bad);
      log.subscribe(good);
      log.append(mkEntry());
      expect(bad).toHaveBeenCalledTimes(1);
      expect(good).toHaveBeenCalledTimes(1);
    });
  });

  describe('defaultRepQualityLog', () => {
    it('is usable as a shared instance', () => {
      const before = defaultRepQualityLog.size();
      defaultRepQualityLog.append(mkEntry({ sessionId: 'default-test', repIndex: 1 }));
      expect(defaultRepQualityLog.size()).toBeGreaterThan(before);
      defaultRepQualityLog.clear('default-test');
      expect(defaultRepQualityLog.entries('default-test')).toHaveLength(0);
    });
  });
});
