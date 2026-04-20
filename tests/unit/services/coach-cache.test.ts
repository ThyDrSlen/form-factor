// Unit tests for lib/services/coach-cache.ts (issue #465 Item 3).

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  fnv1a,
  getCacheKey,
  readCache,
  writeCache,
  withCoachCache,
  clearCacheKey,
  __resetInFlightMapForTest,
} from '@/lib/services/coach-cache';
import type { CoachMessage } from '@/lib/services/coach-service';

beforeEach(async () => {
  jest.useRealTimers();
  await AsyncStorage.clear();
  __resetInFlightMapForTest();
});

const sampleMessages: CoachMessage[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'plan a push day' },
];

describe('fnv1a', () => {
  it('produces a stable hash for identical input', () => {
    expect(fnv1a('hello')).toBe(fnv1a('hello'));
  });
  it('produces a different hash for differing input', () => {
    expect(fnv1a('hello')).not.toBe(fnv1a('world'));
  });
  it('returns a base36 string (no negative numbers, no decimals)', () => {
    const hash = fnv1a('any input');
    expect(hash).toMatch(/^[a-z0-9]+$/);
    expect(hash).not.toContain('-');
  });
  it('reference vector: empty string hashes to FNV offset basis', () => {
    // 0x811c9dc5 in base36 = '17gfeqi' (verified manually)
    expect(fnv1a('')).toBe((0x811c9dc5).toString(36));
  });
});

describe('getCacheKey', () => {
  it('uses the last user message, ignoring earlier turns', () => {
    const a = getCacheKey([{ role: 'user', content: 'first' }, { role: 'user', content: 'second' }]);
    const b = getCacheKey([{ role: 'system', content: 'sys' }, { role: 'user', content: 'second' }]);
    expect(a).toBe(b);
  });

  it('differentiates by focus + sessionId in context', () => {
    const a = getCacheKey(sampleMessages, { focus: 'squat' });
    const b = getCacheKey(sampleMessages, { focus: 'pull' });
    expect(a).not.toBe(b);

    const c = getCacheKey(sampleMessages, { sessionId: 'abc' });
    const d = getCacheKey(sampleMessages, { sessionId: 'xyz' });
    expect(c).not.toBe(d);
  });

  it('shaper flag changes the key (Item 5: shaped responses must not collide with raw)', () => {
    const raw = getCacheKey(sampleMessages, undefined, { shaper: false });
    const shaped = getCacheKey(sampleMessages, undefined, { shaper: true });
    expect(raw).not.toBe(shaped);
  });

  it('starts with the shared coach:cache: prefix so callers can scan/clear', () => {
    expect(getCacheKey(sampleMessages)).toMatch(/^coach:cache:v1:/);
  });
});

describe('readCache + writeCache', () => {
  it('round-trips a fresh entry', async () => {
    const key = getCacheKey(sampleMessages);
    const message: CoachMessage = { role: 'assistant', content: 'plan: 4x5 bench' };
    await writeCache(key, message, 60_000);

    const entry = await readCache(key);
    expect(entry?.message).toEqual(message);
    expect(entry?.ts).toBeGreaterThan(0);
    expect(entry?.ttlMs).toBe(60_000);
  });

  it('returns null on miss', async () => {
    expect(await readCache('coach:cache:v1:nope')).toBeNull();
  });

  it('returns null + auto-cleans expired entries', async () => {
    const key = getCacheKey(sampleMessages);
    const message: CoachMessage = { role: 'assistant', content: 'expired' };
    // Write with a tiny TTL, then advance Date.now via a spy.
    await writeCache(key, message, 10);
    const realNow = Date.now;
    jest.spyOn(Date, 'now').mockImplementation(() => realNow() + 100);
    expect(await readCache(key)).toBeNull();
    jest.restoreAllMocks();
    // Best-effort cleanup may have removed it.
    const stillThere = await AsyncStorage.getItem(key);
    expect(stillThere).toBeNull();
  });

  it('returns null on corrupted JSON', async () => {
    const key = 'coach:cache:v1:bad';
    await AsyncStorage.setItem(key, 'not-json');
    expect(await readCache(key)).toBeNull();
  });

  it('clearCacheKey removes the entry', async () => {
    const key = getCacheKey(sampleMessages);
    await writeCache(key, { role: 'assistant', content: 'x' }, 60_000);
    await clearCacheKey(key);
    expect(await readCache(key)).toBeNull();
  });

  it('writeCache(ttlMs<=0) skips persistence entirely', async () => {
    const key = getCacheKey(sampleMessages);
    await writeCache(key, { role: 'assistant', content: 'x' }, 0);
    expect(await AsyncStorage.getItem(key)).toBeNull();
  });
});

describe('withCoachCache', () => {
  it('returns the cached message on hit (does not call the producer)', async () => {
    const key = getCacheKey(sampleMessages);
    await writeCache(key, { role: 'assistant', content: 'cached' }, 60_000);

    const producer = jest.fn(async () => ({
      role: 'assistant' as const,
      content: 'fresh',
    }));
    const result = await withCoachCache(sampleMessages, undefined, 60_000, producer);

    expect(result.content).toBe('cached');
    expect(producer).not.toHaveBeenCalled();
  });

  it('calls the producer + writes to cache on miss', async () => {
    const producer = jest.fn(async () => ({
      role: 'assistant' as const,
      content: 'fresh',
    }));
    const result = await withCoachCache(sampleMessages, undefined, 60_000, producer);
    expect(result.content).toBe('fresh');
    expect(producer).toHaveBeenCalledTimes(1);

    // Subsequent call hits the cache.
    const again = await withCoachCache(sampleMessages, undefined, 60_000, producer);
    expect(again.content).toBe('fresh');
    expect(producer).toHaveBeenCalledTimes(1);
  });

  it('dedupes simultaneous identical requests onto one promise', async () => {
    let resolveProducer: ((m: CoachMessage) => void) | null = null;
    const producer = jest.fn(
      () =>
        new Promise<CoachMessage>((resolve) => {
          resolveProducer = resolve;
        })
    );

    const a = withCoachCache(sampleMessages, undefined, 60_000, producer);
    const b = withCoachCache(sampleMessages, undefined, 60_000, producer);
    const c = withCoachCache(sampleMessages, undefined, 60_000, producer);

    // Yield several microtasks so the await readCache() resolves and the
    // producer is registered in the in-flight map for the simultaneous calls.
    await new Promise((r) => setTimeout(r, 0));

    // Producer called exactly once; the other two callers should be awaiting it.
    expect(producer).toHaveBeenCalledTimes(1);

    resolveProducer!({ role: 'assistant', content: 'shared' });

    const [aR, bR, cR] = await Promise.all([a, b, c]);
    expect(aR.content).toBe('shared');
    expect(bR.content).toBe('shared');
    expect(cR.content).toBe('shared');
    expect(producer).toHaveBeenCalledTimes(1);
  });

  it('expired entry triggers a fresh fetch', async () => {
    const key = getCacheKey(sampleMessages);
    await writeCache(key, { role: 'assistant', content: 'stale' }, 10);

    // Advance time past TTL.
    const realNow = Date.now;
    jest.spyOn(Date, 'now').mockImplementation(() => realNow() + 100);

    const producer = jest.fn(async () => ({
      role: 'assistant' as const,
      content: 'fresh',
    }));
    const result = await withCoachCache(sampleMessages, undefined, 60_000, producer);
    expect(result.content).toBe('fresh');
    expect(producer).toHaveBeenCalledTimes(1);

    jest.restoreAllMocks();
  });

  it('cacheMs=0 bypasses the cache entirely (no read, no write, no dedup)', async () => {
    const producer = jest.fn(async () => ({
      role: 'assistant' as const,
      content: 'always-fresh',
    }));
    const a = await withCoachCache(sampleMessages, undefined, 0, producer);
    const b = await withCoachCache(sampleMessages, undefined, 0, producer);
    expect(a.content).toBe('always-fresh');
    expect(b.content).toBe('always-fresh');
    expect(producer).toHaveBeenCalledTimes(2);

    // Nothing was persisted.
    const key = getCacheKey(sampleMessages);
    expect(await AsyncStorage.getItem(key)).toBeNull();
  });

  it('producer rejection clears the in-flight slot so retries work', async () => {
    const producer = jest
      .fn<Promise<CoachMessage>, []>()
      .mockRejectedValueOnce(new Error('upstream blew up'))
      .mockResolvedValueOnce({ role: 'assistant', content: 'second-try' });

    await expect(
      withCoachCache(sampleMessages, undefined, 60_000, producer)
    ).rejects.toThrow('upstream blew up');

    const result = await withCoachCache(sampleMessages, undefined, 60_000, producer);
    expect(result.content).toBe('second-try');
    expect(producer).toHaveBeenCalledTimes(2);
  });

  it('cache key includes shaper flag so shaped + raw responses do not collide (Item 5)', async () => {
    const producerRaw = jest.fn(async () => ({
      role: 'assistant' as const,
      content: 'raw',
    }));
    const producerShaped = jest.fn(async () => ({
      role: 'assistant' as const,
      content: 'shaped',
    }));

    const raw = await withCoachCache(sampleMessages, undefined, 60_000, producerRaw, {
      shaper: false,
    });
    const shaped = await withCoachCache(sampleMessages, undefined, 60_000, producerShaped, {
      shaper: true,
    });

    expect(raw.content).toBe('raw');
    expect(shaped.content).toBe('shaped');
    expect(producerRaw).toHaveBeenCalledTimes(1);
    expect(producerShaped).toHaveBeenCalledTimes(1);
  });
});
