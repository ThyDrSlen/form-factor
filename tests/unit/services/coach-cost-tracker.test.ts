import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  __clearDailyBudgetOverridesForTests,
  __invalidateHydrationForTests,
  __internal,
  __setDailyBudgetForTests,
  assertDailyBudget,
  getAvailableBudget,
  getWeeklyAggregate,
  isBudgetExceededError,
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

describe('coach-cost-tracker — per-surface daily budgets (#592)', () => {
  const NOW = '2026-04-17T12:00:00.000Z';

  beforeEach(() => {
    __clearDailyBudgetOverridesForTests();
  });

  it('reports full remaining headroom when no usage has been recorded', async () => {
    const remaining = await getAvailableBudget('session_generator', NOW);
    expect(remaining).toBe(50_000);
  });

  it('subtracts tokensIn + tokensOut from the configured daily cap', async () => {
    await recordCoachUsage({
      at: NOW,
      provider: 'gemma_cloud',
      taskKind: 'session_generator',
      tokensIn: 1_000,
      tokensOut: 400,
    });
    const remaining = await getAvailableBudget('session_generator', NOW);
    expect(remaining).toBe(48_600);
  });

  it('returns Infinity for surfaces without a configured budget', async () => {
    const remaining = await getAvailableBudget('chat', NOW);
    expect(remaining).toBe(Number.POSITIVE_INFINITY);
  });

  it('clamps remaining at 0 once usage meets or exceeds the budget', async () => {
    __setDailyBudgetForTests('warmup_generator', 100);
    await recordCoachUsage({
      at: NOW,
      provider: 'gemma_cloud',
      taskKind: 'warmup_generator',
      tokensIn: 150,
      tokensOut: 0,
    });
    const remaining = await getAvailableBudget('warmup_generator', NOW);
    expect(remaining).toBe(0);
  });

  it('assertDailyBudget is a no-op while under budget', async () => {
    await expect(assertDailyBudget('session_generator', NOW)).resolves.toBeUndefined();
  });

  it('assertDailyBudget throws a typed BudgetExceededError once exhausted', async () => {
    __setDailyBudgetForTests('warmup_generator', 500);
    await recordCoachUsage({
      at: NOW,
      provider: 'gemma_cloud',
      taskKind: 'warmup_generator',
      tokensIn: 400,
      tokensOut: 200,
    });
    try {
      await assertDailyBudget('warmup_generator', NOW);
      throw new Error('expected assertDailyBudget to throw');
    } catch (err) {
      expect(isBudgetExceededError(err)).toBe(true);
      if (isBudgetExceededError(err)) {
        expect(err.domain).toBe('coach');
        expect(err.code).toBe('COACH_BUDGET_EXCEEDED');
        expect(err.taskKind).toBe('warmup_generator');
        expect(err.dailyBudget).toBe(500);
        expect(err.usedTokens).toBeGreaterThanOrEqual(500);
        expect(err.retryable).toBe(false);
      }
    }
  });

  it('only considers today-date buckets when computing remaining budget', async () => {
    await recordCoachUsage({
      at: '2026-04-16T10:00:00.000Z',
      provider: 'gemma_cloud',
      taskKind: 'session_generator',
      tokensIn: 40_000,
      tokensOut: 9_999,
    });
    // Yesterday's usage must NOT count against today's quota.
    const remaining = await getAvailableBudget('session_generator', NOW);
    expect(remaining).toBe(50_000);
  });
});
