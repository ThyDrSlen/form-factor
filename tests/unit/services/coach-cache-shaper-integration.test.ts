// Cache + shaper integration tests (#465 Item 5).
//
// Verifies that:
// - When `opts.shaper = true`, the cache key is different than the unshaped
//   key, so the two never collide.
// - A cached entry produced under `shaper: true` is served back on
//   subsequent calls without invoking the producer (fast path), which is the
//   user-facing win Item 5 promised.
// - Pre-shaped response stored once is read fast on N subsequent calls.

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  withCoachCache,
  getCacheKey,
  __resetInFlightMapForTest,
} from '@/lib/services/coach-cache';
import { shapeFinalResponse } from '@/lib/services/coach-output-shaper';
import type { CoachMessage } from '@/lib/services/coach-service';

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetInFlightMapForTest();
});

const messages: CoachMessage[] = [{ role: 'user', content: 'plan a push day' }];

describe('cache + shaper integration', () => {
  it('stores the shaped response so subsequent reads return shaped text', async () => {
    const rawResponse =
      '   Push day plan: Bench 4x5. Incline DB 3x8. Tricep pushdowns 3x12.   ';
    const shaped = shapeFinalResponse(rawResponse); // identity-trim placeholder

    const producer = jest.fn(async () => ({
      role: 'assistant' as const,
      content: shaped,
    }));

    const first = await withCoachCache(messages, undefined, 60_000, producer, {
      shaper: true,
    });
    expect(first.content).toBe(shaped);
    expect(producer).toHaveBeenCalledTimes(1);

    // Subsequent calls hit the cache; producer is never re-invoked.
    for (let i = 0; i < 5; i++) {
      const next = await withCoachCache(messages, undefined, 60_000, producer, {
        shaper: true,
      });
      expect(next.content).toBe(shaped);
    }
    expect(producer).toHaveBeenCalledTimes(1);
  });

  it('does not return a shaped cached entry when caller asks for raw (different cache key)', async () => {
    const shapedProducer = jest.fn(async () => ({
      role: 'assistant' as const,
      content: 'shaped reply',
    }));
    const rawProducer = jest.fn(async () => ({
      role: 'assistant' as const,
      content: 'raw reply',
    }));

    // Populate the shaped slot.
    await withCoachCache(messages, undefined, 60_000, shapedProducer, {
      shaper: true,
    });

    // A raw call must not hit the shaped slot - different cache key.
    const raw = await withCoachCache(messages, undefined, 60_000, rawProducer, {
      shaper: false,
    });
    expect(raw.content).toBe('raw reply');
    expect(rawProducer).toHaveBeenCalledTimes(1);

    // Verify both entries are present in storage under different keys.
    const shapedKey = getCacheKey(messages, undefined, { shaper: true });
    const rawKey = getCacheKey(messages, undefined, { shaper: false });
    expect(shapedKey).not.toBe(rawKey);
    expect(await AsyncStorage.getItem(shapedKey)).not.toBeNull();
    expect(await AsyncStorage.getItem(rawKey)).not.toBeNull();
  });

  it('round-trip: shape -> write -> read returns the shaped text byte-for-byte', async () => {
    const original = '   first sentence.    second sentence.   ';
    const shaped = shapeFinalResponse(original);

    const key = getCacheKey(messages, undefined, { shaper: true });

    // Write directly via the cache wrapper.
    const producer = jest.fn(async () => ({
      role: 'assistant' as const,
      content: shaped,
    }));
    await withCoachCache(messages, undefined, 60_000, producer, { shaper: true });

    // Read via the cache wrapper - producer not called again.
    const cached = await withCoachCache(messages, undefined, 60_000, producer, {
      shaper: true,
    });
    expect(cached.content).toBe(shaped);

    // And via the storage layer directly.
    const raw = await AsyncStorage.getItem(key);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.message.content).toBe(shaped);
    expect(parsed.shaped).toBe(true);
  });
});
