/**
 * Tests for the monthly PB + streak aggregates on form-session-history.
 * Kept in a sibling file so the original append/read suite stays untouched.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  appendFormSessionHistory,
  countConsecutiveSessionDays,
  countPbsThisMonth,
} from '@/lib/services/form-session-history';

describe('countPbsThisMonth', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('returns 0 when there are no entries', async () => {
    const count = await countPbsThisMonth({ now: new Date('2026-04-21T12:00:00Z') });
    expect(count).toBe(0);
  });

  it('counts ascending PBs within the same month', async () => {
    // Four entries on pullup this month, each at least 2 points above the
    // previous best → 3 PBs (the first session doesn't beat anything).
    await appendFormSessionHistory({
      exerciseKey: 'pullup',
      avgFqi: 70,
      endedAt: '2026-04-01T10:00:00Z',
    });
    await appendFormSessionHistory({
      exerciseKey: 'pullup',
      avgFqi: 75,
      endedAt: '2026-04-05T10:00:00Z',
    });
    await appendFormSessionHistory({
      exerciseKey: 'pullup',
      avgFqi: 78,
      endedAt: '2026-04-10T10:00:00Z',
    });
    await appendFormSessionHistory({
      exerciseKey: 'pullup',
      avgFqi: 80,
      endedAt: '2026-04-15T10:00:00Z',
    });
    const count = await countPbsThisMonth({ now: new Date('2026-04-21T12:00:00Z') });
    // First session (70) doesn't count (nothing to beat in this log).
    // 75 beats 70 by 5 (>=2) → PB. 78 beats 75 by 3 → PB. 80 beats 78 by 2 → PB.
    expect(count).toBe(3);
  });

  it('ignores PBs set in prior months', async () => {
    await appendFormSessionHistory({
      exerciseKey: 'pullup',
      avgFqi: 70,
      endedAt: '2026-03-01T10:00:00Z',
    });
    await appendFormSessionHistory({
      exerciseKey: 'pullup',
      avgFqi: 80,
      endedAt: '2026-03-15T10:00:00Z',
    });
    const count = await countPbsThisMonth({ now: new Date('2026-04-21T12:00:00Z') });
    expect(count).toBe(0);
  });

  it('aggregates across multiple exercises', async () => {
    await appendFormSessionHistory({
      exerciseKey: 'pullup',
      avgFqi: 70,
      endedAt: '2026-04-01T10:00:00Z',
    });
    await appendFormSessionHistory({
      exerciseKey: 'pullup',
      avgFqi: 76,
      endedAt: '2026-04-10T10:00:00Z',
    });
    await appendFormSessionHistory({
      exerciseKey: 'squat',
      avgFqi: 60,
      endedAt: '2026-04-05T10:00:00Z',
    });
    await appendFormSessionHistory({
      exerciseKey: 'squat',
      avgFqi: 68,
      endedAt: '2026-04-12T10:00:00Z',
    });
    const count = await countPbsThisMonth({ now: new Date('2026-04-21T12:00:00Z') });
    // pullup: 76 vs 70 = +6 → PB. squat: 68 vs 60 = +8 → PB. → 2
    expect(count).toBe(2);
  });

  it('includes a candidate session when it would set a PB', async () => {
    await appendFormSessionHistory({
      exerciseKey: 'pullup',
      avgFqi: 70,
      endedAt: '2026-04-01T10:00:00Z',
    });
    const count = await countPbsThisMonth({
      now: new Date('2026-04-21T12:00:00Z'),
      candidate: { exerciseKey: 'pullup', avgFqi: 90 },
    });
    expect(count).toBe(1);
  });
});

describe('countConsecutiveSessionDays', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('returns 0 when there are no entries at all', async () => {
    const streak = await countConsecutiveSessionDays({
      now: new Date('2026-04-21T12:00:00Z'),
    });
    expect(streak).toBe(0);
  });

  it('returns 0 when today is empty', async () => {
    await appendFormSessionHistory({
      exerciseKey: 'pullup',
      avgFqi: 70,
      endedAt: '2026-04-19T10:00:00Z',
    });
    const streak = await countConsecutiveSessionDays({
      now: new Date('2026-04-21T12:00:00Z'),
    });
    expect(streak).toBe(0);
  });

  it('counts contiguous days ending today', async () => {
    for (const day of ['2026-04-19', '2026-04-20', '2026-04-21']) {
      await appendFormSessionHistory({
        exerciseKey: 'pullup',
        avgFqi: 80,
        endedAt: `${day}T10:00:00Z`,
      });
    }
    const streak = await countConsecutiveSessionDays({
      now: new Date('2026-04-21T12:00:00Z'),
    });
    expect(streak).toBe(3);
  });

  it('stops at the first gap', async () => {
    // Days: 15, 16, _, 18, 19, 20, 21 → streak = 4 (18-21)
    for (const day of ['2026-04-15', '2026-04-16', '2026-04-18', '2026-04-19', '2026-04-20', '2026-04-21']) {
      await appendFormSessionHistory({
        exerciseKey: 'pullup',
        avgFqi: 80,
        endedAt: `${day}T10:00:00Z`,
      });
    }
    const streak = await countConsecutiveSessionDays({
      now: new Date('2026-04-21T12:00:00Z'),
    });
    expect(streak).toBe(4);
  });

  it('de-duplicates multiple sessions on the same day', async () => {
    await appendFormSessionHistory({
      exerciseKey: 'pullup',
      avgFqi: 80,
      endedAt: '2026-04-21T09:00:00Z',
    });
    await appendFormSessionHistory({
      exerciseKey: 'squat',
      avgFqi: 75,
      endedAt: '2026-04-21T15:00:00Z',
    });
    const streak = await countConsecutiveSessionDays({
      now: new Date('2026-04-21T18:00:00Z'),
    });
    expect(streak).toBe(1);
  });
});
