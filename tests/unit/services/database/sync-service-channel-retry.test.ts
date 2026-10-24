/** @jest-environment node */

// Exercise the real lifecycle with inert Supabase channels: no database or network.
type ChannelStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED';
type SubscribeCallback = (status: ChannelStatus, error?: Error) => void;

interface FakeChannel {
  name: string;
  filter?: string;
  on: jest.Mock;
  subscribe: jest.Mock;
  unsubscribe: jest.Mock;
  fire: (status: ChannelStatus, error?: Error) => void;
}

const mockChannels: FakeChannel[] = [];
const mockRemoveChannel = jest.fn().mockResolvedValue(undefined);
const mockChannel = jest.fn((name: string): FakeChannel => {
  let callback: SubscribeCallback | undefined;
  const channel: FakeChannel = {
    name,
    on: jest.fn((_event: string, config: { filter?: string }) => {
      channel.filter = config.filter;
      return channel;
    }),
    subscribe: jest.fn((onStatus: SubscribeCallback) => {
      callback = onStatus;
      return channel;
    }),
    unsubscribe: jest.fn().mockResolvedValue(undefined),
    // Retain the callback after removal to simulate already-queued SDK events.
    fire: (status, error) => callback?.(status, error),
  };
  mockChannels.push(channel);
  return channel;
});

jest.mock('@/lib/supabase', () => ({
  supabase: {
    channel: (name: string) => mockChannel(name),
    removeChannel: (channel: FakeChannel) => mockRemoveChannel(channel),
  },
}));

jest.mock('@/lib/services/database/local-db', () => ({
  localDB: { supportsWorkoutSync: false },
}));

jest.mock('@/lib/services/database/generic-sync', () => ({
  WORKOUT_SYNC_CONFIGS: [],
}));

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
}));

jest.mock('@/lib/services/ErrorHandler', () => ({
  createError: jest.fn(),
  logError: jest.fn(),
}));

import { syncService } from '@/lib/services/database/sync-service';

const workoutsChannels = () => mockChannels.filter(channel => channel.name === 'workouts_changes');

async function initializeOldUser(): Promise<FakeChannel> {
  await syncService.initializeRealtimeSync('old-user');
  expect(mockChannels).toHaveLength(4);
  expect(workoutsChannels()).toHaveLength(1);
  const channel = workoutsChannels()[0];
  expect(channel.subscribe).toHaveBeenCalledTimes(1);
  expect(channel.filter).toBe('user_id=eq.old-user');
  channel.fire('SUBSCRIBED');
  return channel;
}

async function scheduleRetry(channel: FakeChannel): Promise<void> {
  channel.fire('CHANNEL_ERROR', new Error('websocket dropped'));
  // Flush unsubscribe/removeChannel promises without reaching the 1s retry.
  await jest.advanceTimersByTimeAsync(0);
  expect(channel.unsubscribe).toHaveBeenCalledTimes(1);
  expect(mockRemoveChannel).toHaveBeenCalledWith(channel);
  expect(jest.getTimerCount()).toBe(1);
}

describe('SyncService managed channel retry lifecycle', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await syncService.cleanupRealtimeSync();
    jest.clearAllTimers();
    jest.clearAllMocks();
    mockChannels.length = 0;
  });

  afterEach(async () => {
    await syncService.cleanupRealtimeSync();
    // Failed assertions must not leak the intentionally exposed retry into another test.
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('replaces a CHANNEL_ERROR channel when its scheduled retry becomes due', async () => {
    const oldChannel = await initializeOldUser();
    await scheduleRetry(oldChannel);

    await jest.advanceTimersByTimeAsync(999);
    expect(workoutsChannels()).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);

    expect(workoutsChannels()).toHaveLength(2);
    const replacement = workoutsChannels()[1];
    expect(replacement).not.toBe(oldChannel);
    expect(replacement.filter).toBe('user_id=eq.old-user');
    expect(replacement.subscribe).toHaveBeenCalledTimes(1);
    replacement.fire('SUBSCRIBED');
    await jest.advanceTimersByTimeAsync(60_000);
    expect(workoutsChannels()).toHaveLength(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('cleanup cancels a scheduled retry instead of resurrecting its old-user channel', async () => {
    const oldChannel = await initializeOldUser();
    await scheduleRetry(oldChannel);
    const channelsBeforeCleanup = mockChannels.length;

    await syncService.cleanupRealtimeSync();
    const pendingTimersAfterCleanup = jest.getTimerCount();
    // Advance even if a timer leaked, so the failure reports actual resurrection too.
    await jest.advanceTimersByTimeAsync(60_000);

    expect({
      pendingTimersAfterCleanup,
      recreatedChannelFilters: mockChannels.slice(channelsBeforeCleanup).map(channel => channel.filter),
    }).toEqual({
      pendingTimersAfterCleanup: 0,
      recreatedChannelFilters: [],
    });
  });

  it.each<ChannelStatus>(['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT'])(
    'ignores a delayed old-channel %s callback after cleanup so a new user can initialize',
    async status => {
      const oldChannel = await initializeOldUser();
      await syncService.cleanupRealtimeSync();
      expect(mockRemoveChannel).toHaveBeenCalledWith(oldChannel);
      expect(jest.getTimerCount()).toBe(0);
      const channelsAfterCleanup = mockChannels.length;
      const removalsAfterCleanup = mockRemoveChannel.mock.calls.length;

      // The SDK delivers a queued status callback after logout has completed.
      oldChannel.fire(status, status === 'SUBSCRIBED' ? undefined : new Error('late old-user error'));
      await jest.advanceTimersByTimeAsync(0);
      const pendingTimersAfterLateCallback = jest.getTimerCount();
      await jest.advanceTimersByTimeAsync(60_000);
      await syncService.initializeRealtimeSync('new-user');

      expect({
        pendingTimersAfterLateCallback,
        extraRemovals: mockRemoveChannel.mock.calls.length - removalsAfterCleanup,
        createdChannelFilters: mockChannels.slice(channelsAfterCleanup).map(channel => channel.filter),
      }).toEqual({
        pendingTimersAfterLateCallback: 0,
        extraRemovals: 0,
        createdChannelFilters: Array(4).fill('user_id=eq.new-user'),
      });
      expect(jest.getTimerCount()).toBe(0);
    },
  );
});
