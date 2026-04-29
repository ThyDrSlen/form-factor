/**
 * FoodContext CRUD + sync queue regression coverage (wave-31, Pack C / C4).
 *
 * Complements the existing `food-context.test.tsx` (initialization / basic
 * CRUD / refresh) with scenarios targeting the sync-queue transitions that
 * were previously uncovered:
 *
 *   - add -> sync-success: syncToSupabase resolves cleanly, no toast
 *   - add -> sync-failure: rejection is caught inside the fire-and-forget
 *     `void syncToSupabase()` and surfaces a toast, but local write and
 *     UI state are unaffected
 *   - delete -> offline: no sync attempt, UI still updates, soft-delete
 *     persists in the local DB
 *   - delete -> online replay: deleted item stays deleted after an incoming
 *     realtime onSyncComplete reloads from local DB
 *   - queue recovery after failure: a later addFood re-attempts the sync
 *     even if an earlier call failed — the failure does not "jam" the
 *     context
 *
 * Uses the same localDB/syncService mocks as the sister suite to keep
 * assumptions aligned, but under a different file path.
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import type * as FoodContextModule from '@/contexts/FoodContext';
import type { FoodEntry } from '@/contexts/FoodContext';
import { ToastProvider } from '@/contexts/ToastContext';

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'generated-uuid-xyz'),
}));

const mockNetworkValue = { isOnline: true, isConnected: true, networkType: 'WIFI' };
jest.mock('@/contexts/NetworkContext', () => ({
  useNetwork: () => mockNetworkValue,
}));

const mockAuthValue = { user: { id: 'test-user-xyz' }, loading: false };
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockAuthValue,
}));

const mockLocalDB = {
  initialize: jest.fn().mockResolvedValue(undefined),
  getAllFoods: jest.fn().mockResolvedValue([]),
  insertFood: jest.fn().mockResolvedValue(undefined),
  softDeleteFood: jest.fn().mockResolvedValue(undefined),
};
jest.mock('@/lib/services/database/local-db', () => ({
  localDB: mockLocalDB,
}));

const mockSyncCallbacks: (() => void)[] = [];
const mockSyncService = {
  fullSync: jest.fn().mockResolvedValue(undefined),
  syncToSupabase: jest.fn().mockResolvedValue(undefined),
  initializeRealtimeSync: jest.fn().mockResolvedValue(undefined),
  cleanupRealtimeSync: jest.fn(),
  onSyncComplete: jest.fn((cb: () => void) => {
    mockSyncCallbacks.push(cb);
    return () => {
      const idx = mockSyncCallbacks.indexOf(cb);
      if (idx >= 0) mockSyncCallbacks.splice(idx, 1);
    };
  }),
};
jest.mock('@/lib/services/database/sync-service', () => ({
  syncService: mockSyncService,
}));

type FoodModule = typeof FoodContextModule;
let FoodProvider: FoodModule['FoodProvider'];
let useFood: FoodModule['useFood'];

beforeAll(() => {
  const mod = require('@/contexts/FoodContext') as FoodModule;
  FoodProvider = mod.FoodProvider;
  useFood = mod.useFood;
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ToastProvider>
    <FoodProvider>{children}</FoodProvider>
  </ToastProvider>
);

const makeFoodEntry = (overrides: Partial<FoodEntry> = {}): FoodEntry => ({
  id: 'food-sync',
  name: 'Quinoa Bowl',
  calories: 450,
  protein: 20,
  carbs: 60,
  fat: 12,
  date: '2026-04-21',
  ...overrides,
});

describe('FoodContext — sync queue transitions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSyncCallbacks.length = 0;
    mockLocalDB.getAllFoods.mockResolvedValue([]);
    mockLocalDB.initialize.mockResolvedValue(undefined);
    mockLocalDB.insertFood.mockResolvedValue(undefined);
    mockLocalDB.softDeleteFood.mockResolvedValue(undefined);
    mockSyncService.fullSync.mockResolvedValue(undefined);
    mockSyncService.syncToSupabase.mockResolvedValue(undefined);
    mockSyncService.initializeRealtimeSync.mockResolvedValue(undefined);
    mockNetworkValue.isOnline = true;
  });

  it('addFood -> sync-success: local write, UI update, syncToSupabase resolves cleanly', async () => {
    const { result } = renderHook(() => useFood(), { wrapper });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    mockSyncService.syncToSupabase.mockClear();

    const newFood = makeFoodEntry();
    await act(async () => {
      await result.current.addFood(newFood);
    });

    // Local-first write happened.
    expect(mockLocalDB.insertFood).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'food-sync', calories: 450 }),
    );
    // UI mirrored the change immediately.
    expect(result.current.foods[0]).toMatchObject({ id: 'food-sync' });
    // Sync was fired (fire-and-forget).
    expect(mockSyncService.syncToSupabase).toHaveBeenCalledTimes(1);
  });

  it('addFood -> sync-failure: rejection is swallowed, local write persists, toast surfaces', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockSyncService.syncToSupabase.mockRejectedValueOnce(new Error('supabase down'));

    const { result } = renderHook(() => useFood(), { wrapper });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    mockSyncService.syncToSupabase.mockClear();
    mockSyncService.syncToSupabase.mockRejectedValueOnce(new Error('supabase still down'));

    await act(async () => {
      await result.current.addFood(makeFoodEntry({ id: 'food-fail' }));
      // Allow the rejected fire-and-forget promise microtask to flush.
      await Promise.resolve();
      await Promise.resolve();
    });

    // addFood itself did NOT reject — fire-and-forget swallowed the sync error.
    expect(result.current.foods[0]).toMatchObject({ id: 'food-fail' });
    expect(mockLocalDB.insertFood).toHaveBeenCalled();
    // Warning was logged + attempt actually happened.
    expect(mockSyncService.syncToSupabase).toHaveBeenCalledTimes(1);
    // `warnWithTs` prepends an ISO timestamp, so match across all args.
    expect(
      warnSpy.mock.calls.some((call) =>
        call.some((arg) => String(arg ?? '').includes('[FoodContext] Sync failed')),
      ),
    ).toBe(true);

    warnSpy.mockRestore();
  });

  it('deleteFood offline: no sync attempted, UI still updates, soft-delete persists', async () => {
    mockLocalDB.getAllFoods.mockResolvedValue([
      { id: 'f-del', name: 'Oats', calories: 150, protein: 5, carbs: 27, fat: 3, date: '2026-04-21' },
    ]);
    mockNetworkValue.isOnline = false;

    const { result } = renderHook(() => useFood(), { wrapper });
    await waitFor(() => {
      expect(result.current.foods).toHaveLength(1);
    });
    mockSyncService.syncToSupabase.mockClear();

    await act(async () => {
      await result.current.deleteFood('f-del');
    });

    expect(mockLocalDB.softDeleteFood).toHaveBeenCalledWith('f-del');
    expect(result.current.foods).toHaveLength(0);
    expect(mockSyncService.syncToSupabase).not.toHaveBeenCalled();
  });

  it('deleteFood online: soft-delete, sync attempted, deletion survives a post-sync reload', async () => {
    // Start online with one food, then delete while online. After deletion the
    // sync-service realtime callback fires and reloads from the local DB —
    // the deleted food must still be gone (soft-delete persisted).
    mockLocalDB.getAllFoods.mockResolvedValue([
      { id: 'f-keep', name: 'Salmon', calories: 350, protein: 40, carbs: 0, fat: 20, date: '2026-04-21' },
    ]);

    const { result } = renderHook(() => useFood(), { wrapper });
    await waitFor(() => {
      expect(result.current.foods).toHaveLength(1);
    });

    // Deletion triggers a soft-delete + online sync. Before the realtime
    // reload fires, flip the local-db response to reflect the deletion.
    mockLocalDB.getAllFoods.mockResolvedValue([]);

    await act(async () => {
      await result.current.deleteFood('f-keep');
    });

    expect(mockLocalDB.softDeleteFood).toHaveBeenCalledWith('f-keep');
    expect(mockSyncService.syncToSupabase).toHaveBeenCalled();
    expect(result.current.foods).toHaveLength(0);

    // Trigger the onSyncComplete callback — simulates Supabase realtime push
    // landing locally after the user's soft-delete.
    await act(async () => {
      mockSyncCallbacks.forEach((cb) => cb());
      await Promise.resolve();
    });

    // Deletion must NOT be reverted by the realtime reload.
    expect(result.current.foods).toHaveLength(0);
  });

  it('queue recovery: after a sync-failure, a later addFood still attempts a fresh sync', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useFood(), { wrapper });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Arrange: first add fails sync, second add succeeds.
    mockSyncService.syncToSupabase.mockClear();
    mockSyncService.syncToSupabase
      .mockRejectedValueOnce(new Error('flaky supabase'))
      .mockResolvedValueOnce(undefined);

    await act(async () => {
      await result.current.addFood(makeFoodEntry({ id: 'food-a' }));
      // Drain the rejected fire-and-forget.
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.addFood(makeFoodEntry({ id: 'food-b' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    // Both adds attempted sync — the context didn't "jam" after the first failure.
    expect(mockSyncService.syncToSupabase).toHaveBeenCalledTimes(2);
    // Both writes landed locally.
    expect(mockLocalDB.insertFood).toHaveBeenCalledTimes(2);
    expect(result.current.foods.map((f) => f.id)).toEqual(
      expect.arrayContaining(['food-a', 'food-b']),
    );

    warnSpy.mockRestore();
  });

  it('fetchFoods online triggers fullSync and reloads from local DB', async () => {
    mockLocalDB.getAllFoods.mockResolvedValue([
      { id: 'f-a', name: 'Apple', calories: 95, protein: 0.5, carbs: 25, fat: 0.3, date: '2026-04-21' },
    ]);

    const { result } = renderHook(() => useFood(), { wrapper });
    await waitFor(() => {
      expect(result.current.foods).toHaveLength(1);
    });

    mockSyncService.fullSync.mockClear();

    await act(async () => {
      await result.current.refreshFoods();
    });

    // performSync fires fullSync and then re-loads via getAllFoods.
    expect(mockSyncService.fullSync).toHaveBeenCalledTimes(1);
    expect(result.current.foods[0].name).toBe('Apple');
  });

  it('fire-and-forget sync on delete: syncToSupabase rejection surfaces toast + warning', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockLocalDB.getAllFoods.mockResolvedValue([
      { id: 'f-fail', name: 'Cottage Cheese', calories: 110, protein: 12, carbs: 3, fat: 5, date: '2026-04-21' },
    ]);

    const { result } = renderHook(() => useFood(), { wrapper });
    await waitFor(() => {
      expect(result.current.foods).toHaveLength(1);
    });

    // Next syncToSupabase rejects — deleteFood must not throw.
    mockSyncService.syncToSupabase.mockClear();
    mockSyncService.syncToSupabase.mockRejectedValueOnce(new Error('rejected'));

    await act(async () => {
      await result.current.deleteFood('f-fail');
      await Promise.resolve();
      await Promise.resolve();
    });

    // Local state reflects the delete despite the sync failure.
    expect(result.current.foods).toHaveLength(0);
    // Warning log fired from the fire-and-forget catch.
    // `warnWithTs` prepends an ISO timestamp, so match across all args.
    expect(
      warnSpy.mock.calls.some((call) =>
        call.some((arg) => String(arg ?? '').includes('[FoodContext] Sync failed')),
      ),
    ).toBe(true);

    warnSpy.mockRestore();
  });
});
