/**
 * Tests for coach-cost-guard — weekly-cap wrapper that throws a typed
 * COACH_COST_CAP_EXCEEDED error when the caller's provider has exceeded
 * its token budget.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  __invalidateHydrationForTests,
  recordCoachUsage,
} from '@/lib/services/coach-cost-tracker';
import {
  assertUnderWeeklyCap,
  getWeeklyTokenCap,
} from '@/lib/services/coach-cost-guard';

const CAP_ENV = 'EXPO_PUBLIC_COACH_WEEKLY_TOKEN_CAP';
const ORIGINAL_CAP = process.env[CAP_ENV];

describe('coach-cost-guard — getWeeklyTokenCap', () => {
  afterEach(() => {
    if (ORIGINAL_CAP === undefined) delete process.env[CAP_ENV];
    else process.env[CAP_ENV] = ORIGINAL_CAP;
  });

  it('returns POSITIVE_INFINITY when env var is unset', () => {
    delete process.env[CAP_ENV];
    expect(getWeeklyTokenCap()).toBe(Number.POSITIVE_INFINITY);
  });

  it('returns POSITIVE_INFINITY when env var is empty', () => {
    process.env[CAP_ENV] = '';
    expect(getWeeklyTokenCap()).toBe(Number.POSITIVE_INFINITY);
  });

  it('returns POSITIVE_INFINITY when env var is NaN', () => {
    process.env[CAP_ENV] = 'not-a-number';
    expect(getWeeklyTokenCap()).toBe(Number.POSITIVE_INFINITY);
  });

  it('returns POSITIVE_INFINITY when env var is zero or negative (fail-open)', () => {
    process.env[CAP_ENV] = '0';
    expect(getWeeklyTokenCap()).toBe(Number.POSITIVE_INFINITY);
    process.env[CAP_ENV] = '-5';
    expect(getWeeklyTokenCap()).toBe(Number.POSITIVE_INFINITY);
  });

  it('parses a positive integer cap', () => {
    process.env[CAP_ENV] = '50000';
    expect(getWeeklyTokenCap()).toBe(50000);
  });
});

describe('coach-cost-guard — assertUnderWeeklyCap', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    __invalidateHydrationForTests();
  });

  afterEach(() => {
    if (ORIGINAL_CAP === undefined) delete process.env[CAP_ENV];
    else process.env[CAP_ENV] = ORIGINAL_CAP;
  });

  it('is a no-op when cap env is unset (disabled)', async () => {
    delete process.env[CAP_ENV];
    // Even if we've recorded millions of tokens, no cap means no throw.
    await recordCoachUsage({
      provider: 'gemma_cloud',
      taskKind: 'chat',
      tokensIn: 1_000_000,
      tokensOut: 1_000_000,
    });
    await expect(assertUnderWeeklyCap('gemma_cloud')).resolves.toBeUndefined();
  });

  it('passes silently when usage is under the cap', async () => {
    process.env[CAP_ENV] = '10000';
    await recordCoachUsage({
      provider: 'gemma_cloud',
      taskKind: 'chat',
      tokensIn: 500,
      tokensOut: 500,
    });
    await expect(assertUnderWeeklyCap('gemma_cloud')).resolves.toBeUndefined();
  });

  it('throws COACH_COST_CAP_EXCEEDED when usage >= cap', async () => {
    process.env[CAP_ENV] = '1000';
    await recordCoachUsage({
      provider: 'gemma_cloud',
      taskKind: 'chat',
      tokensIn: 600,
      tokensOut: 500, // total 1100 > cap 1000
    });

    await expect(assertUnderWeeklyCap('gemma_cloud')).rejects.toMatchObject({
      domain: 'validation',
      code: 'COACH_COST_CAP_EXCEEDED',
      retryable: false,
    });
  });

  it('throws at boundary (usage exactly equal to cap)', async () => {
    process.env[CAP_ENV] = '1000';
    await recordCoachUsage({
      provider: 'gemma_cloud',
      taskKind: 'chat',
      tokensIn: 500,
      tokensOut: 500, // total 1000 === cap
    });

    await expect(assertUnderWeeklyCap('gemma_cloud')).rejects.toMatchObject({
      code: 'COACH_COST_CAP_EXCEEDED',
    });
  });

  it('tracks per-provider: OpenAI cap state is independent of Gemma', async () => {
    process.env[CAP_ENV] = '1000';
    // Exhaust OpenAI's budget
    await recordCoachUsage({
      provider: 'openai',
      taskKind: 'chat',
      tokensIn: 800,
      tokensOut: 400,
    });
    // Gemma is untouched → still under cap
    await expect(assertUnderWeeklyCap('gemma_cloud')).resolves.toBeUndefined();
    // But OpenAI itself would be over
    await expect(assertUnderWeeklyCap('openai')).rejects.toMatchObject({
      code: 'COACH_COST_CAP_EXCEEDED',
    });
  });

  it('includes the consumption/cap numbers in error details for telemetry', async () => {
    process.env[CAP_ENV] = '500';
    await recordCoachUsage({
      provider: 'gemma_cloud',
      taskKind: 'chat',
      tokensIn: 300,
      tokensOut: 300, // total 600
    });

    await expect(assertUnderWeeklyCap('gemma_cloud')).rejects.toMatchObject({
      details: expect.objectContaining({
        provider: 'gemma_cloud',
        used: 600,
        cap: 500,
      }),
    });
  });

  it('only counts tokens inside the weekly window', async () => {
    process.env[CAP_ENV] = '1000';
    // 10 days ago — outside the 7-day weekly window → should NOT count.
    const oldIso = new Date(Date.now() - 10 * 86400_000).toISOString();
    await recordCoachUsage({
      at: oldIso,
      provider: 'gemma_cloud',
      taskKind: 'chat',
      tokensIn: 5000,
      tokensOut: 5000,
    });

    // Today, small usage → under cap.
    await recordCoachUsage({
      provider: 'gemma_cloud',
      taskKind: 'chat',
      tokensIn: 100,
      tokensOut: 100,
    });

    await expect(assertUnderWeeklyCap('gemma_cloud')).resolves.toBeUndefined();
  });
});
