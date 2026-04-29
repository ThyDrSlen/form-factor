/**
 * Tests for SyncService.cleanupRealtimeSync() — the logout lifecycle path.
 *
 * Asserts that every currently-open Supabase realtime channel is torn down
 * exactly once when the user signs out, and that internal retry / state
 * bookkeeping is cleared so a subsequent login does not re-fire stale
 * subscriptions.
 *
 * Closes #544 — "realtime channel lifecycle on logout".
 */

// ---------------------------------------------------------------------------
// Supabase mock
// ---------------------------------------------------------------------------

const mockRemoveChannel = jest.fn().mockResolvedValue(undefined);

function makeChannelStub(name: string) {
  return {
    _name: name,
    on: jest.fn().mockReturnThis(),
    subscribe: jest.fn().mockReturnThis(),
    unsubscribe: jest.fn().mockResolvedValue(undefined),
  } as const;
}

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }),
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: jest.fn(() => ({
        data: { subscription: { unsubscribe: jest.fn() } },
      })),
    },
    channel: jest.fn(),
    removeChannel: (...args: unknown[]) => mockRemoveChannel(...args),
  },
}));

jest.mock('@/lib/services/database/local-db', () => ({
  localDB: {},
}));

jest.mock('@/lib/services/database/generic-sync', () => ({
  syncAllWorkoutTablesToSupabase: jest.fn(),
  downloadAllWorkoutTablesFromSupabase: jest.fn(),
  cleanupWorkoutSyncedDeletes: jest.fn(),
  WORKOUT_SYNC_CONFIGS: [],
  handleGenericRealtimeChange: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
}));

jest.mock('@/lib/services/ErrorHandler', () => ({
  createError: jest.fn((_d: string, _c: string, m: string) => ({ message: m })),
  logError: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { syncService } from '@/lib/services/database/sync-service';

type ChannelStub = ReturnType<typeof makeChannelStub>;

function seedAllChannels(): {
  food: ChannelStub;
  workout: ChannelStub;
  health: ChannelStub;
  nutrition: ChannelStub;
  sessions: ChannelStub[];
} {
  const food = makeChannelStub('food');
  const workout = makeChannelStub('workout');
  const health = makeChannelStub('health');
  const nutrition = makeChannelStub('nutrition');
  const sessions = [makeChannelStub('s1'), makeChannelStub('s2')];

  const svc = syncService as any;
  svc.foodChannel = food;
  svc.workoutChannel = workout;
  svc.healthChannel = health;
  svc.nutritionGoalsChannel = nutrition;
  svc.workoutSessionChannels = [...sessions];

  // Seed bookkeeping maps so we can assert they get cleared.
  svc.channelRetryCount.set('food', 1);
  svc.channelRetryCount.set('workout', 2);
  svc.channelStates.set('food', 'SUBSCRIBED');
  svc.channelStates.set('health', 'SUBSCRIBING');

  // Pending timers that should be cleared.
  svc.conflictSyncTimer = setTimeout(() => {}, 60_000);
  svc.realtimeResyncTimer = setTimeout(() => {}, 60_000);

  return { food, workout, health, nutrition, sessions };
}

describe('SyncService.cleanupRealtimeSync — logout lifecycle (#544)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Hard-reset the singleton's realtime state so a previous test's seed
    // does not leak into the next one.
    const svc = syncService as any;
    svc.foodChannel = null;
    svc.workoutChannel = null;
    svc.healthChannel = null;
    svc.nutritionGoalsChannel = null;
    svc.workoutSessionChannels = [];
    svc.channelRetryCount.clear();
    svc.channelStates.clear();
    if (svc.conflictSyncTimer) {
      clearTimeout(svc.conflictSyncTimer);
      svc.conflictSyncTimer = null;
    }
    if (svc.realtimeResyncTimer) {
      clearTimeout(svc.realtimeResyncTimer);
      svc.realtimeResyncTimer = null;
    }
  });

  test('removes every open channel exactly once', async () => {
    const { food, workout, health, nutrition, sessions } = seedAllChannels();

    await syncService.cleanupRealtimeSync();

    // One removeChannel per owned channel: 4 fixed + 2 session = 6 total.
    expect(mockRemoveChannel).toHaveBeenCalledTimes(6);
    expect(mockRemoveChannel).toHaveBeenCalledWith(food);
    expect(mockRemoveChannel).toHaveBeenCalledWith(workout);
    expect(mockRemoveChannel).toHaveBeenCalledWith(health);
    expect(mockRemoveChannel).toHaveBeenCalledWith(nutrition);
    for (const s of sessions) {
      expect(mockRemoveChannel).toHaveBeenCalledWith(s);
    }
  });

  test('nulls out every channel reference so a re-login does not reuse stale refs', async () => {
    seedAllChannels();

    await syncService.cleanupRealtimeSync();

    const svc = syncService as any;
    expect(svc.foodChannel).toBeNull();
    expect(svc.workoutChannel).toBeNull();
    expect(svc.healthChannel).toBeNull();
    expect(svc.nutritionGoalsChannel).toBeNull();
    expect(svc.workoutSessionChannels).toEqual([]);
  });

  test('clears channelRetryCount and channelStates bookkeeping', async () => {
    seedAllChannels();
    const svc = syncService as any;
    // Precondition sanity check.
    expect(svc.channelRetryCount.size).toBeGreaterThan(0);
    expect(svc.channelStates.size).toBeGreaterThan(0);

    await syncService.cleanupRealtimeSync();

    expect(svc.channelRetryCount.size).toBe(0);
    expect(svc.channelStates.size).toBe(0);
  });

  test('clears pending conflict + realtime resync timers', async () => {
    seedAllChannels();
    const svc = syncService as any;
    expect(svc.conflictSyncTimer).not.toBeNull();
    expect(svc.realtimeResyncTimer).not.toBeNull();

    await syncService.cleanupRealtimeSync();

    expect(svc.conflictSyncTimer).toBeNull();
    expect(svc.realtimeResyncTimer).toBeNull();
  });

  test('is idempotent: second call with no channels is a no-op (no crash, no extra removeChannel)', async () => {
    seedAllChannels();
    await syncService.cleanupRealtimeSync();
    const callsAfterFirst = mockRemoveChannel.mock.calls.length;

    // Second pass on a cleaned instance.
    await syncService.cleanupRealtimeSync();

    expect(mockRemoveChannel).toHaveBeenCalledTimes(callsAfterFirst);
  });

  test('handles an empty workoutSessionChannels array without errors', async () => {
    const svc = syncService as any;
    svc.foodChannel = makeChannelStub('food');
    // No workout session channels, no other channels.
    svc.workoutSessionChannels = [];

    await expect(syncService.cleanupRealtimeSync()).resolves.toBeUndefined();
    expect(mockRemoveChannel).toHaveBeenCalledTimes(1);
    expect(svc.workoutSessionChannels).toEqual([]);
  });
});
