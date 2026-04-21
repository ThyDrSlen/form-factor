import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  __invalidateHydrationForTests,
  __internal,
  getWeeklyAggregate,
  recordCoachUsage,
  resetCoachCostTracker,
} from '@/lib/services/coach-cost-tracker';

beforeEach(async () => {
  await AsyncStorage.clear();
  __invalidateHydrationForTests();
});

describe('coach-cost-tracker — recordCoachUsage + getWeeklyAggregate', () => {
  it('starts empty', async () => {
    const agg = await getWeeklyAggregate('2026-04-17T12:00:00.000Z');
    expect(agg.totalCalls).toBe(0);
    expect(agg.totalTokensIn).toBe(0);
    expect(agg.totalTokensOut).toBe(0);
    expect(agg.cacheHitRate).toBe(0);
  });

  it('records a single event', async () => {
    await recordCoachUsage({
      at: '2026-04-17T10:00:00.000Z',
      provider: 'openai',
      taskKind: 'chat',
      tokensIn: 500,
      tokensOut: 200,
    });
    const agg = await getWeeklyAggregate('2026-04-17T12:00:00.000Z');
    expect(agg.totalCalls).toBe(1);
    expect(agg.totalTokensIn).toBe(500);
    expect(agg.totalTokensOut).toBe(200);
    expect(agg.byProvider.openai.calls).toBe(1);
    expect(agg.byTaskKind.chat.tokensIn).toBe(500);
  });

  it('accumulates multiple events in the same bucket', async () => {
    for (let i = 0; i < 3; i += 1) {
      await recordCoachUsage({
        at: '2026-04-17T10:00:00.000Z',
        provider: 'gemma_cloud',
        taskKind: 'debrief',
        tokensIn: 100,
        tokensOut: 50,
      });
    }
    const agg = await getWeeklyAggregate('2026-04-17T12:00:00.000Z');
    expect(agg.totalCalls).toBe(3);
    expect(agg.totalTokensIn).toBe(300);
    expect(agg.totalTokensOut).toBe(150);
    expect(agg.byProvider.gemma_cloud.calls).toBe(3);
  });

  it('splits into separate buckets per (date, provider, taskKind)', async () => {
    await recordCoachUsage({
      at: '2026-04-16T10:00:00.000Z',
      provider: 'openai',
      taskKind: 'chat',
      tokensIn: 100,
      tokensOut: 50,
    });
    await recordCoachUsage({
      at: '2026-04-17T10:00:00.000Z',
      provider: 'openai',
      taskKind: 'chat',
      tokensIn: 100,
      tokensOut: 50,
    });
    await recordCoachUsage({
      at: '2026-04-17T10:00:00.000Z',
      provider: 'gemma_cloud',
      taskKind: 'chat',
      tokensIn: 100,
      tokensOut: 50,
    });
    const agg = await getWeeklyAggregate('2026-04-17T12:00:00.000Z');
    expect(agg.totalCalls).toBe(3);
    expect(agg.byProvider.openai.calls).toBe(2);
    expect(agg.byProvider.gemma_cloud.calls).toBe(1);
  });

  it('respects the 7-day weekly window (excludes older buckets)', async () => {
    // 10 days ago → should be excluded from weekly aggregate
    await recordCoachUsage({
      at: '2026-04-07T10:00:00.000Z',
      provider: 'openai',
      taskKind: 'chat',
      tokensIn: 999,
      tokensOut: 999,
    });
    // 2 days ago → included
    await recordCoachUsage({
      at: '2026-04-15T10:00:00.000Z',
      provider: 'openai',
      taskKind: 'chat',
      tokensIn: 100,
      tokensOut: 100,
    });
    const agg = await getWeeklyAggregate('2026-04-17T12:00:00.000Z');
    expect(agg.totalCalls).toBe(1);
    expect(agg.totalTokensIn).toBe(100);
  });

  it('tracks cache hit rate', async () => {
    await recordCoachUsage({
      at: '2026-04-17T10:00:00.000Z',
      provider: 'openai',
      taskKind: 'chat',
      tokensIn: 100,
      tokensOut: 50,
      cacheHit: false,
    });
    await recordCoachUsage({
      at: '2026-04-17T10:00:00.000Z',
      provider: 'openai',
      taskKind: 'chat',
      tokensIn: 0,
      tokensOut: 0,
      cacheHit: true,
    });
    await recordCoachUsage({
      at: '2026-04-17T10:00:00.000Z',
      provider: 'openai',
      taskKind: 'chat',
      tokensIn: 0,
      tokensOut: 0,
      cacheHit: true,
    });
    const agg = await getWeeklyAggregate('2026-04-17T12:00:00.000Z');
    expect(agg.totalCalls).toBe(3);
    expect(agg.cacheHitRate).toBeCloseTo(2 / 3, 3);
  });

  it('returns weekly rangeStart/rangeEnd 7 days wide', async () => {
    const agg = await getWeeklyAggregate('2026-04-17T12:00:00.000Z');
    expect(agg.rangeStart).toBe('2026-04-11');
    expect(agg.rangeEnd).toBe('2026-04-18');
  });

  it('persists usage across hydration cycles', async () => {
    await recordCoachUsage({
      at: '2026-04-17T10:00:00.000Z',
      provider: 'openai',
      taskKind: 'drill_explainer',
      tokensIn: 200,
      tokensOut: 100,
    });
    __invalidateHydrationForTests();
    const agg = await getWeeklyAggregate('2026-04-17T12:00:00.000Z');
    expect(agg.totalCalls).toBe(1);
    expect(agg.byTaskKind.drill_explainer.tokensIn).toBe(200);
  });

  it('rounds and floors token counts defensively', async () => {
    await recordCoachUsage({
      at: '2026-04-17T10:00:00.000Z',
      provider: 'openai',
      taskKind: 'chat',
      tokensIn: -5,
      tokensOut: 12.7,
    });
    const agg = await getWeeklyAggregate('2026-04-17T12:00:00.000Z');
    expect(agg.totalTokensIn).toBe(0);
    expect(agg.totalTokensOut).toBe(13);
  });

  it('reset clears both memory and storage', async () => {
    await recordCoachUsage({
      at: '2026-04-17T10:00:00.000Z',
      provider: 'openai',
      taskKind: 'chat',
      tokensIn: 100,
      tokensOut: 50,
    });
    await resetCoachCostTracker();
    const agg = await getWeeklyAggregate('2026-04-17T12:00:00.000Z');
    expect(agg.totalCalls).toBe(0);
    const raw = await AsyncStorage.getItem(__internal.STORAGE_KEY);
    expect(raw).toBeNull();
  });

  it('survives AsyncStorage read failures during hydrate', async () => {
    const spy = jest
      .spyOn(AsyncStorage, 'getItem')
      .mockRejectedValueOnce(new Error('boom'));
    __invalidateHydrationForTests();
    const agg = await getWeeklyAggregate('2026-04-17T12:00:00.000Z');
    expect(agg.totalCalls).toBe(0);
    spy.mockRestore();
  });

  it('prunes buckets older than the retention window on record', async () => {
    // 40 days ago
    await recordCoachUsage({
      at: '2026-03-08T10:00:00.000Z',
      provider: 'openai',
      taskKind: 'chat',
      tokensIn: 100,
      tokensOut: 50,
    });
    // Force today to be 2026-04-17 so old bucket ages out on the new record
    await recordCoachUsage({
      at: '2026-04-17T10:00:00.000Z',
      provider: 'openai',
      taskKind: 'chat',
      tokensIn: 1,
      tokensOut: 1,
    });
    // Weekly aggregate should only see the recent event, confirming the
    // older bucket was pruned (not just filtered out of the 7-day window).
    const agg = await getWeeklyAggregate('2026-04-17T12:00:00.000Z');
    expect(agg.totalCalls).toBe(1);
    expect(agg.totalTokensIn).toBe(1);

    // Re-hydrate from storage and confirm the old bucket is gone from disk too.
    __invalidateHydrationForTests();
    const rehydrated = await getWeeklyAggregate('2026-03-08T12:00:00.000Z');
    expect(rehydrated.totalCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Integration smoke: coach-service Gemma path records usage (#537).
//
// The production wiring fires recordCoachUsage fire-and-forget so a coach
// turn never blocks on the tracker. Here we call recordCoachUsage directly
// to mirror what the wiring does, then read getWeeklyAggregate back — if
// the bucket shape / provider enum drift, this catches it.
// ---------------------------------------------------------------------------
describe('coach-cost-tracker — wiring smoke (#537)', () => {
  it('records a gemma_cloud chat event that rolls up into the weekly aggregate', async () => {
    await recordCoachUsage({
      at: '2026-04-17T10:00:00.000Z',
      provider: 'gemma_cloud',
      taskKind: 'chat',
      tokensIn: 25, // 100 chars of prompt / 4
      tokensOut: 13, // 50 chars of reply / 4
    });
    const agg = await getWeeklyAggregate('2026-04-17T12:00:00.000Z');
    expect(agg.byProvider.gemma_cloud.calls).toBe(1);
    expect(agg.byProvider.gemma_cloud.tokensIn).toBe(25);
    expect(agg.byProvider.gemma_cloud.tokensOut).toBe(13);
    expect(agg.byTaskKind.chat.calls).toBe(1);
  });

  it('records an openai debrief event with estimated tokens', async () => {
    await recordCoachUsage({
      at: '2026-04-17T10:00:00.000Z',
      provider: 'openai',
      taskKind: 'debrief',
      tokensIn: 120,
      tokensOut: 80,
    });
    const agg = await getWeeklyAggregate('2026-04-17T12:00:00.000Z');
    expect(agg.byProvider.openai.calls).toBe(1);
    expect(agg.byTaskKind.debrief.tokensIn).toBe(120);
    expect(agg.byTaskKind.debrief.tokensOut).toBe(80);
  });

  it('rolls up mixed provider/taskKind events across the week', async () => {
    await recordCoachUsage({
      at: '2026-04-17T10:00:00.000Z',
      provider: 'gemma_cloud',
      taskKind: 'chat',
      tokensIn: 10,
      tokensOut: 10,
    });
    await recordCoachUsage({
      at: '2026-04-17T11:00:00.000Z',
      provider: 'gemma_cloud',
      taskKind: 'debrief',
      tokensIn: 40,
      tokensOut: 20,
    });
    await recordCoachUsage({
      at: '2026-04-16T10:00:00.000Z',
      provider: 'openai',
      taskKind: 'drill_explainer',
      tokensIn: 30,
      tokensOut: 15,
    });
    const agg = await getWeeklyAggregate('2026-04-17T12:00:00.000Z');
    expect(agg.totalCalls).toBe(3);
    expect(agg.byProvider.gemma_cloud.calls).toBe(2);
    expect(agg.byProvider.openai.calls).toBe(1);
    expect(agg.byTaskKind.chat.calls).toBe(1);
    expect(agg.byTaskKind.debrief.calls).toBe(1);
    expect(agg.byTaskKind.drill_explainer.calls).toBe(1);
  });
});
