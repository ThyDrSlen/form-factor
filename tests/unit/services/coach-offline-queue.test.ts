import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  COACH_QUEUE_MAX_ENTRIES,
  COACH_QUEUE_STORAGE_KEY,
  clear,
  drain,
  enqueue,
  pending,
  type CoachQueueEntry,
  type CoachQueueReplay,
} from '@/lib/services/coach-offline-queue';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('coach-offline-queue — enqueue + pending', () => {
  it('starts empty', async () => {
    expect(await pending()).toEqual([]);
  });

  it('stores a single entry with a stable id + timestamp', async () => {
    const entry = await enqueue({
      prompt: 'why did my squat depth drop?',
      taskKind: 'chat',
      id: 'test-1',
      timestamp: 1_700_000_000_000,
    });
    expect(entry).toEqual({
      id: 'test-1',
      prompt: 'why did my squat depth drop?',
      taskKind: 'chat',
      timestamp: 1_700_000_000_000,
    });
    const snapshot = await pending();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toEqual(entry);
  });

  it('preserves insertion order (oldest first)', async () => {
    await enqueue({ prompt: 'first', taskKind: 'chat', id: 'a', timestamp: 1 });
    await enqueue({ prompt: 'second', taskKind: 'chat', id: 'b', timestamp: 2 });
    await enqueue({ prompt: 'third', taskKind: 'chat', id: 'c', timestamp: 3 });
    const snapshot = await pending();
    expect(snapshot.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('generates a fallback id + timestamp when omitted', async () => {
    const entry = await enqueue({ prompt: 'auto', taskKind: 'other' });
    expect(entry.id).toMatch(/^coach-q-/);
    expect(Number.isFinite(entry.timestamp)).toBe(true);
  });

  it('includes optional context when provided', async () => {
    const entry = await enqueue({
      prompt: 'what went wrong',
      taskKind: 'debrief',
      context: 'session:abc123',
    });
    expect(entry.context).toBe('session:abc123');
  });

  it('omits context from storage when not provided', async () => {
    const entry = await enqueue({ prompt: 'p', taskKind: 'chat' });
    expect(entry).not.toHaveProperty('context');
  });

  it('rejects empty prompts', async () => {
    await expect(enqueue({ prompt: '', taskKind: 'chat' })).rejects.toThrow(/required/);
    await expect(enqueue({ prompt: '   ', taskKind: 'chat' })).rejects.toThrow(/required/);
  });

  it('caps the queue at COACH_QUEUE_MAX_ENTRIES, dropping oldest', async () => {
    for (let i = 0; i < COACH_QUEUE_MAX_ENTRIES + 5; i += 1) {
      await enqueue({
        prompt: `prompt-${i}`,
        taskKind: 'chat',
        id: `id-${i}`,
        timestamp: i,
      });
    }
    const snapshot = await pending();
    expect(snapshot).toHaveLength(COACH_QUEUE_MAX_ENTRIES);
    // Oldest 5 should have been dropped — first remaining id is 5.
    expect(snapshot[0].id).toBe('id-5');
    expect(snapshot[snapshot.length - 1].id).toBe(
      `id-${COACH_QUEUE_MAX_ENTRIES + 4}`,
    );
  });
});

describe('coach-offline-queue — drain', () => {
  async function seed(prefix: string, count: number) {
    for (let i = 0; i < count; i += 1) {
      await enqueue({
        prompt: `${prefix}-${i}`,
        taskKind: 'chat',
        id: `${prefix}-${i}`,
        timestamp: i,
      });
    }
  }

  it('returns an empty report when there is nothing to replay', async () => {
    const replay = jest.fn<Promise<'ok'>, [CoachQueueEntry]>();
    const report = await drain(replay);
    expect(report).toEqual({ attempted: 0, ok: 0, retry: 0, dropped: 0 });
    expect(replay).not.toHaveBeenCalled();
  });

  it('replays entries oldest-first and clears them on ok', async () => {
    await seed('x', 3);
    const order: string[] = [];
    const replay: CoachQueueReplay = async (entry) => {
      order.push(entry.id);
      return 'ok';
    };

    const report = await drain(replay);
    expect(report).toEqual({ attempted: 3, ok: 3, retry: 0, dropped: 0 });
    expect(order).toEqual(['x-0', 'x-1', 'x-2']);
    expect(await pending()).toHaveLength(0);
  });

  it('keeps entries that return "retry"', async () => {
    await seed('y', 3);
    const replay: CoachQueueReplay = async (entry) => {
      return entry.id === 'y-1' ? 'retry' : 'ok';
    };
    const report = await drain(replay);
    expect(report).toEqual({ attempted: 3, ok: 2, retry: 1, dropped: 0 });
    const remaining = await pending();
    expect(remaining.map((e) => e.id)).toEqual(['y-1']);
  });

  it('removes entries that return "drop" without treating them as ok', async () => {
    await seed('z', 2);
    const replay: CoachQueueReplay = async (entry) => {
      return entry.id === 'z-0' ? 'drop' : 'ok';
    };
    const report = await drain(replay);
    expect(report).toEqual({ attempted: 2, ok: 1, retry: 0, dropped: 1 });
    expect(await pending()).toHaveLength(0);
  });

  it('treats thrown replay errors as retry (never loses user prompts)', async () => {
    await seed('e', 2);
    const replay: CoachQueueReplay = async (entry) => {
      if (entry.id === 'e-0') throw new Error('transient network');
      return 'ok';
    };
    const report = await drain(replay);
    expect(report).toEqual({ attempted: 2, ok: 1, retry: 1, dropped: 0 });
    expect((await pending()).map((e) => e.id)).toEqual(['e-0']);
  });

  it('survives a single corrupt stored entry and drains the rest', async () => {
    await AsyncStorage.setItem(
      COACH_QUEUE_STORAGE_KEY,
      JSON.stringify([
        { id: 'good', prompt: 'hi', taskKind: 'chat', timestamp: 1 },
        { notAnEntry: true },
        { id: 'alsoGood', prompt: 'there', taskKind: 'chat', timestamp: 2 },
      ]),
    );
    const replay = jest.fn<Promise<'ok'>, [CoachQueueEntry]>(async () => 'ok');
    const report = await drain(replay);
    expect(report.attempted).toBe(2);
    expect(report.ok).toBe(2);
    expect(replay).toHaveBeenCalledTimes(2);
  });
});

describe('coach-offline-queue — clear', () => {
  it('empties the queue', async () => {
    await enqueue({ prompt: 'x', taskKind: 'chat' });
    expect(await pending()).toHaveLength(1);
    await clear();
    expect(await pending()).toHaveLength(0);
  });

  it('swallows storage errors during clear (best-effort)', async () => {
    const original = AsyncStorage.removeItem;
    (AsyncStorage as unknown as { removeItem: typeof AsyncStorage.removeItem }).removeItem =
      jest.fn().mockRejectedValueOnce(new Error('disk full')) as typeof AsyncStorage.removeItem;
    try {
      await expect(clear()).resolves.toBeUndefined();
    } finally {
      (AsyncStorage as unknown as { removeItem: typeof AsyncStorage.removeItem }).removeItem =
        original;
    }
  });
});

describe('coach-offline-queue — storage error resilience', () => {
  it('returns an empty queue when storage throws on read', async () => {
    const original = AsyncStorage.getItem;
    (AsyncStorage as unknown as { getItem: typeof AsyncStorage.getItem }).getItem =
      jest.fn().mockRejectedValueOnce(new Error('disk full')) as typeof AsyncStorage.getItem;
    try {
      expect(await pending()).toEqual([]);
    } finally {
      (AsyncStorage as unknown as { getItem: typeof AsyncStorage.getItem }).getItem = original;
    }
  });

  it('returns an empty queue when storage contains non-JSON garbage', async () => {
    await AsyncStorage.setItem(COACH_QUEUE_STORAGE_KEY, 'not-json{');
    expect(await pending()).toEqual([]);
  });

  it('returns an empty queue when the stored value is a non-array JSON blob', async () => {
    await AsyncStorage.setItem(
      COACH_QUEUE_STORAGE_KEY,
      JSON.stringify({ nope: true }),
    );
    expect(await pending()).toEqual([]);
  });
});
