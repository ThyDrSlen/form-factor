import { Platform } from 'react-native';

// ---------------------------------------------------------------------------
// Mocks — jest.mock() is hoisted, so factories must be self-contained.
// We grab references to the mock functions AFTER the factory runs.
// ---------------------------------------------------------------------------

jest.mock('expo-notifications', () => ({
  __esModule: true,
  DEFAULT_ACTION_IDENTIFIER: 'expo.notifications.actions.DEFAULT',
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  setNotificationHandler: jest.fn(),
  setNotificationCategoryAsync: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
  addPushTokenListener: jest.fn(),
  AndroidImportance: { MAX: 5 },
}));

jest.mock('expo-device', () => ({
  __esModule: true,
  isDevice: true,
}));

jest.mock('expo-crypto', () => ({
  __esModule: true,
  getRandomBytesAsync: jest.fn(),
}));

jest.mock('expo-application', () => ({
  __esModule: true,
  nativeApplicationVersion: '1.0.0',
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        eas: { projectId: 'test-project-id' },
        supabaseUrl: 'https://test.supabase.co',
        supabaseAnonKey: 'test-key',
      },
    },
  },
}));

jest.mock('expo-modules-core', () => ({
  PermissionStatus: {
    GRANTED: 'granted',
    DENIED: 'denied',
    UNDETERMINED: 'undetermined',
  },
}));

// Logger — silence output
jest.mock('@/lib/logger', () => ({
  errorWithTs: jest.fn(),
  infoWithTs: jest.fn(),
  warnWithTs: jest.fn(),
  logWithTs: jest.fn(),
}));

// Supabase — we build chains per-test, so the factory just provides `from`
const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: any[]) => mockFrom(...args) },
}));

// ---------------------------------------------------------------------------
// Obtain references to the mock functions created inside the factories
// ---------------------------------------------------------------------------

import * as Notifications from 'expo-notifications';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PermissionStatus } from 'expo-modules-core';

const mockGetPermissionsAsync = Notifications.getPermissionsAsync as jest.Mock;
const mockRequestPermissionsAsync = Notifications.requestPermissionsAsync as jest.Mock;
const mockGetExpoPushTokenAsync = Notifications.getExpoPushTokenAsync as jest.Mock;
const mockSetNotificationChannelAsync = Notifications.setNotificationChannelAsync as jest.Mock;
const mockSetNotificationHandler = Notifications.setNotificationHandler as jest.Mock;
const mockSetNotificationCategoryAsync = Notifications.setNotificationCategoryAsync as jest.Mock;
const mockAddNotificationResponseReceivedListener = Notifications.addNotificationResponseReceivedListener as jest.Mock;
const mockAddPushTokenListener = Notifications.addPushTokenListener as jest.Mock;
const mockGetRandomBytesAsync = Crypto.getRandomBytesAsync as jest.Mock;
const dismissedActionIdentifier = 'expo.notifications.actions.DISMISSED';

// ---------------------------------------------------------------------------
// Import the module under test AFTER all mocks are in place
// ---------------------------------------------------------------------------

import {
  getNotificationPermissions,
  getNotificationRoute,
  handleNotificationResponse,
  requestNotificationPermissions,
  registerDevicePushToken,
  startPushTokenRefreshListener,
  stopPushTokenRefreshListener,
  syncPushTokenRefreshListener,
  unregisterDevicePushToken,
  loadNotificationPreferences,
  updateNotificationPreferences,
} from '@/lib/services/notifications';

// Capture the module-level setNotificationHandler call BEFORE beforeEach clears mocks.
// notifications.ts calls setNotificationHandler at module scope (line 42), and
// jest.clearAllMocks() wipes the call history, so we snapshot it here.
const notificationHandlerCallCount = mockSetNotificationHandler.mock.calls.length;
const notificationHandlerArg =
  mockSetNotificationHandler.mock.calls.length > 0
    ? mockSetNotificationHandler.mock.calls[0][0]
    : undefined;
const initialNotificationCategoryCalls = Promise.resolve()
  .then(() => Promise.resolve())
  .then(() => mockSetNotificationCategoryAsync.mock.calls.map((call) => [...call]));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a Uint8Array of `len` bytes with predictable values 0x00..0x0f. */
function fakeBytes(len: number): Uint8Array {
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) arr[i] = i;
  return arr;
}

/**
 * Build a Supabase-style chainable query mock.
 * Every chaining method returns the same object so the chain resolves
 * to `{ data, error, status }` regardless of call order.
 */
function createChain(data: any, error: any = null, status = 200) {
  const resolved = { data, error, status };
  const chain: Record<string, jest.Mock> = {};
  const methods = ['select', 'eq', 'match', 'single', 'upsert', 'delete'];
  methods.forEach((m) => {
    chain[m] = jest.fn().mockReturnValue(chain);
  });
  // Make the chain thenable so `await supabase.from(...).select(...)` works
  Object.defineProperty(chain, 'then', {
    value: (onFulfilled: any, onRejected?: any) =>
      Promise.resolve(resolved).then(onFulfilled, onRejected),
    configurable: true,
  });
  return chain;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  (AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined);

  // Default: permissions granted
  mockGetPermissionsAsync.mockResolvedValue({ status: 'granted' });
  mockRequestPermissionsAsync.mockResolvedValue({ status: 'granted' });
  mockGetExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[abc123]' });
  mockGetRandomBytesAsync.mockResolvedValue(fakeBytes(16));
  mockSetNotificationChannelAsync.mockResolvedValue(undefined);
  mockSetNotificationCategoryAsync.mockResolvedValue(undefined);
  mockAddNotificationResponseReceivedListener.mockReturnValue({ remove: jest.fn() });
  mockAddPushTokenListener.mockReturnValue({ remove: jest.fn() });

  // Reset Platform.OS to ios
  (Platform as any).OS = 'ios';
});

// ===========================================================================
// getNotificationPermissions
// ===========================================================================

describe('getNotificationPermissions', () => {
  it('returns granted when permissions are granted', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ status: 'granted' });

    const result = await getNotificationPermissions();

    expect(result).toBe('granted');
    expect(mockGetPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('returns denied when permissions are denied', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ status: 'denied' });

    const result = await getNotificationPermissions();

    expect(result).toBe('denied');
  });

  it('returns undetermined when not yet requested', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ status: 'undetermined' });

    const result = await getNotificationPermissions();

    expect(result).toBe('undetermined');
  });
});

// ===========================================================================
// requestNotificationPermissions
// ===========================================================================

describe('requestNotificationPermissions', () => {
  it('requests permissions with iOS options and returns status', async () => {
    mockRequestPermissionsAsync.mockResolvedValue({ status: 'granted' });

    const result = await requestNotificationPermissions();

    expect(result).toBe('granted');
    expect(mockRequestPermissionsAsync).toHaveBeenCalledWith({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
        provideAppNotificationSettings: true,
      },
    });
  });

  it('returns denied when user denies', async () => {
    mockRequestPermissionsAsync.mockResolvedValue({ status: 'denied' });

    const result = await requestNotificationPermissions();

    expect(result).toBe('denied');
  });
});

// ===========================================================================
// registerDevicePushToken
// ===========================================================================

describe('registerDevicePushToken', () => {
  it('returns early with error when userId is empty', async () => {
    const result = await registerDevicePushToken('');

    expect(result).toEqual({
      status: PermissionStatus.UNDETERMINED,
      error: 'Missing userId',
    });
    expect(mockGetPermissionsAsync).not.toHaveBeenCalled();
  });

  it('returns early on simulator/web when Device.isDevice is false', async () => {
    // We need to re-import with a different Device mock.
    // The source file uses a dynamic require() for expo-device.
    // The simplest approach: temporarily override the mocked module.
    jest.resetModules();
    jest.doMock('expo-device', () => ({ isDevice: false }));
    // Re-apply all other mocks that resetModules cleared
    jest.doMock('expo-notifications', () => ({
      __esModule: true,
      getPermissionsAsync: jest.fn(),
      requestPermissionsAsync: jest.fn(),
      getExpoPushTokenAsync: jest.fn(),
      setNotificationChannelAsync: jest.fn(),
      setNotificationHandler: jest.fn(),
      setNotificationCategoryAsync: jest.fn(),
      addPushTokenListener: jest.fn(),
      AndroidImportance: { MAX: 5 },
    }));
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: {
        expoConfig: {
          extra: { eas: { projectId: 'test-project-id' } },
        },
      },
    }));
    jest.doMock('expo-crypto', () => ({
      __esModule: true,
      getRandomBytesAsync: jest.fn(),
    }));
    jest.doMock('expo-application', () => ({
      __esModule: true,
      nativeApplicationVersion: '1.0.0',
    }));
    jest.doMock('expo-modules-core', () => ({
      PermissionStatus: {
        GRANTED: 'granted',
        DENIED: 'denied',
        UNDETERMINED: 'undetermined',
      },
    }));
    jest.doMock('@/lib/logger', () => ({
      errorWithTs: jest.fn(),
      infoWithTs: jest.fn(),
      warnWithTs: jest.fn(),
      logWithTs: jest.fn(),
    }));
    jest.doMock('@/lib/supabase', () => ({
      supabase: { from: jest.fn() },
    }));

    const mod = require('@/lib/services/notifications');
    const result = await mod.registerDevicePushToken('user-123');

    expect(result).toEqual({
      status: 'undetermined',
      error: 'Device push unsupported',
    });
  });

  it('returns status without token when permission denied and requestPermission is false', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ status: 'denied' });

    const result = await registerDevicePushToken('user-123', { requestPermission: false });

    expect(result).toEqual({ status: 'denied' });
    expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
    expect(mockGetExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  it('requests permission when not granted and requestPermission is not false', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    mockRequestPermissionsAsync.mockResolvedValue({ status: 'granted' });

    const chain = createChain(null, null);
    mockFrom.mockReturnValue({ upsert: jest.fn().mockResolvedValue({ error: null }) });

    await registerDevicePushToken('user-123');

    expect(mockRequestPermissionsAsync).toHaveBeenCalled();
  });

  it('returns status without token when request is denied after prompt', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    mockRequestPermissionsAsync.mockResolvedValue({ status: 'denied' });

    const result = await registerDevicePushToken('user-123');

    expect(result).toEqual({ status: 'denied' });
    expect(mockGetExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  it('returns error when projectId is missing', async () => {
    jest.resetModules();
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: { expoConfig: { extra: {} } },
    }));
    jest.doMock('expo-device', () => ({ isDevice: true }));
    jest.doMock('expo-notifications', () => ({
      __esModule: true,
      getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
      requestPermissionsAsync: jest.fn(),
      getExpoPushTokenAsync: jest.fn(),
      setNotificationChannelAsync: jest.fn(),
      setNotificationHandler: jest.fn(),
      setNotificationCategoryAsync: jest.fn(),
      addPushTokenListener: jest.fn(),
      AndroidImportance: { MAX: 5 },
    }));
    jest.doMock('expo-crypto', () => ({
      __esModule: true,
      getRandomBytesAsync: jest.fn(),
    }));
    jest.doMock('expo-application', () => ({
      __esModule: true,
      nativeApplicationVersion: '1.0.0',
    }));
    jest.doMock('expo-modules-core', () => ({
      PermissionStatus: {
        GRANTED: 'granted',
        DENIED: 'denied',
        UNDETERMINED: 'undetermined',
      },
    }));
    jest.doMock('@/lib/logger', () => ({
      errorWithTs: jest.fn(),
      infoWithTs: jest.fn(),
      warnWithTs: jest.fn(),
      logWithTs: jest.fn(),
    }));
    jest.doMock('@/lib/supabase', () => ({
      supabase: { from: jest.fn() },
    }));

    const origEnv = process.env.EXPO_PUBLIC_PUSH_PROJECT_ID;
    delete process.env.EXPO_PUBLIC_PUSH_PROJECT_ID;

    const mod = require('@/lib/services/notifications');
    const result = await mod.registerDevicePushToken('user-123');

    expect(result.error).toContain('Missing EXPO_PUBLIC_PUSH_PROJECT_ID');
    expect(result.status).toBe('granted');

    if (origEnv !== undefined) process.env.EXPO_PUBLIC_PUSH_PROJECT_ID = origEnv;
  });

  it('calls setNotificationChannelAsync on Android', async () => {
    (Platform as any).OS = 'android';
    const mockUpsert = jest.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ upsert: mockUpsert });

    await registerDevicePushToken('user-123');

    expect(mockSetNotificationChannelAsync).toHaveBeenCalledWith('default', {
      name: 'General',
      importance: 5,
      lightColor: '#4C8CFF',
    });
  });

  it('does not call setNotificationChannelAsync on iOS', async () => {
    (Platform as any).OS = 'ios';
    const mockUpsert = jest.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ upsert: mockUpsert });

    await registerDevicePushToken('user-123');

    expect(mockSetNotificationChannelAsync).not.toHaveBeenCalled();
  });

  it('success path: gets token, upserts to supabase, caches token', async () => {
    const mockUpsert = jest.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ upsert: mockUpsert });

    const result = await registerDevicePushToken('user-123');

    expect(result.status).toBe('granted');
    expect(result.token).toBe('ExponentPushToken[abc123]');
    expect(result.error).toBeUndefined();

    expect(mockFrom).toHaveBeenCalledWith('notification_tokens');
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'ExponentPushToken[abc123]',
        user_id: 'user-123',
        platform: 'ios',
        app_version: '1.0.0',
        device_id: expect.stringMatching(/^[0-9a-f]{32}$/),
        last_seen_at: expect.any(String),
      }),
    );

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'ff.notifications.last_token',
      'ExponentPushToken[abc123]',
    );
  });

  it('generates a device ID on first call and caches it', async () => {
    const mockUpsert = jest.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ upsert: mockUpsert });

    await registerDevicePushToken('user-123');

    expect(mockGetRandomBytesAsync).toHaveBeenCalledWith(16);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'ff.notifications.device_id',
      expect.stringMatching(/^[0-9a-f]{32}$/),
    );
  });

  it('reuses cached device ID on subsequent calls', async () => {
    const cachedDeviceId = 'aabbccdd11223344aabbccdd11223344';
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === 'ff.notifications.device_id') return Promise.resolve(cachedDeviceId);
      return Promise.resolve(null);
    });
    const mockUpsert = jest.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ upsert: mockUpsert });

    await registerDevicePushToken('user-123');

    expect(mockGetRandomBytesAsync).not.toHaveBeenCalled();
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ device_id: cachedDeviceId }),
    );
  });

  it('retries upsert on failure and returns error after exhausting retries', async () => {
    const upsertError = { message: 'connection timeout' };
    const mockUpsert = jest.fn().mockResolvedValue({ error: upsertError });
    mockFrom.mockReturnValue({ upsert: mockUpsert });

    jest.useFakeTimers();

    const promise = registerDevicePushToken('user-123');

    // The retry loop uses setTimeout. Advance through all retries.
    // Retry 1 delay: 1000ms, Retry 2 delay: 2000ms
    await jest.advanceTimersByTimeAsync(1000);
    await jest.advanceTimersByTimeAsync(2000);

    const result = await promise;

    jest.useRealTimers();

    // 1 initial + 2 retries = 3 calls
    expect(mockUpsert).toHaveBeenCalledTimes(3);
    expect(result.error).toBe('connection timeout');
    expect(result.token).toBe('ExponentPushToken[abc123]');

    // Token should NOT be cached when upsert fails
    expect(AsyncStorage.setItem).not.toHaveBeenCalledWith(
      'ff.notifications.last_token',
      expect.any(String),
    );
  });

  it('succeeds on retry after initial failure', async () => {
    const mockUpsert = jest.fn()
      .mockResolvedValueOnce({ error: { message: 'transient error' } })
      .mockResolvedValueOnce({ error: null });
    mockFrom.mockReturnValue({ upsert: mockUpsert });

    jest.useFakeTimers();
    const promise = registerDevicePushToken('user-123');
    await jest.advanceTimersByTimeAsync(1000);
    const result = await promise;
    jest.useRealTimers();

    expect(mockUpsert).toHaveBeenCalledTimes(2);
    expect(result.error).toBeUndefined();
    expect(result.token).toBe('ExponentPushToken[abc123]');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'ff.notifications.last_token',
      'ExponentPushToken[abc123]',
    );
  });
});

// ===========================================================================
// unregisterDevicePushToken
// ===========================================================================

describe('unregisterDevicePushToken', () => {
  it('does nothing when no cached token exists', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

    await unregisterDevicePushToken('user-123');

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('does nothing when userId is undefined', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('ExponentPushToken[abc123]');

    await unregisterDevicePushToken(undefined);

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('deletes token from supabase and clears cache on success', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('ExponentPushToken[abc123]');
    const mockMatch = jest.fn().mockResolvedValue({ error: null });
    const mockDeleteFn = jest.fn().mockReturnValue({ match: mockMatch });
    mockFrom.mockReturnValue({ delete: mockDeleteFn });

    await unregisterDevicePushToken('user-123');

    expect(mockFrom).toHaveBeenCalledWith('notification_tokens');
    expect(mockMatch).toHaveBeenCalledWith({
      token: 'ExponentPushToken[abc123]',
      user_id: 'user-123',
    });
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('ff.notifications.last_token');
  });

  it('does not clear cache when supabase delete fails', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('ExponentPushToken[abc123]');
    const mockMatch = jest.fn().mockResolvedValue({ error: { message: 'db error' } });
    const mockDeleteFn = jest.fn().mockReturnValue({ match: mockMatch });
    mockFrom.mockReturnValue({ delete: mockDeleteFn });

    await unregisterDevicePushToken('user-123');

    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// loadNotificationPreferences
// ===========================================================================

describe('loadNotificationPreferences', () => {
  const userId = 'user-456';

  const defaultPrefs = {
    user_id: userId,
    comments: true,
    likes: true,
    reminders: true,
    timezone: null,
    quiet_hours: null,
  };

  it('returns existing preferences when row is found', async () => {
    const existingPrefs = {
      user_id: userId,
      comments: false,
      likes: true,
      reminders: false,
      timezone: 'America/New_York',
      quiet_hours: '22:00-07:00',
    };
    const mockSingle = jest.fn().mockResolvedValue({ data: existingPrefs, error: null, status: 200 });
    const mockEq = jest.fn().mockReturnValue({ single: mockSingle });
    const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({ select: mockSelect });

    const result = await loadNotificationPreferences(userId);

    expect(result).toEqual(existingPrefs);
    expect(mockFrom).toHaveBeenCalledWith('notification_preferences');
    expect(mockSelect).toHaveBeenCalledWith('*');
    expect(mockEq).toHaveBeenCalledWith('user_id', userId);
  });

  it('auto-creates defaults on 406 (no row found) and returns created row', async () => {
    // First query: single() returns 406
    const mockSingle = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'no rows found' },
      status: 406,
    });
    const mockEq = jest.fn().mockReturnValue({ single: mockSingle });
    const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });

    // Upsert chain for creating defaults
    const createdPrefs = { ...defaultPrefs, created_at: '2026-01-01T00:00:00Z' };
    const mockUpsertSingle = jest.fn().mockResolvedValue({ data: createdPrefs, error: null });
    const mockUpsertSelect = jest.fn().mockReturnValue({ single: mockUpsertSingle });
    const mockUpsert = jest.fn().mockReturnValue({ select: mockUpsertSelect });

    mockFrom
      .mockReturnValueOnce({ select: mockSelect })  // First call: load
      .mockReturnValueOnce({ upsert: mockUpsert });  // Second call: create

    const result = await loadNotificationPreferences(userId);

    expect(result).toEqual(createdPrefs);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: userId,
        comments: true,
        likes: true,
        reminders: true,
      }),
    );
  });

  it('returns in-memory defaults when auto-create fails after 406', async () => {
    const mockSingle = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'no rows found' },
      status: 406,
    });
    const mockEq = jest.fn().mockReturnValue({ single: mockSingle });
    const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });

    // Upsert fails
    const mockUpsertSingle = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'insert failed' },
    });
    const mockUpsertSelect = jest.fn().mockReturnValue({ single: mockUpsertSingle });
    const mockUpsert = jest.fn().mockReturnValue({ select: mockUpsertSelect });

    mockFrom
      .mockReturnValueOnce({ select: mockSelect })
      .mockReturnValueOnce({ upsert: mockUpsert });

    const result = await loadNotificationPreferences(userId);

    expect(result).toEqual(defaultPrefs);
  });

  it('returns defaults on non-406 DB error without attempting auto-create', async () => {
    const mockSingle = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'internal server error' },
      status: 500,
    });
    const mockEq = jest.fn().mockReturnValue({ single: mockSingle });
    const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({ select: mockSelect });

    const result = await loadNotificationPreferences(userId);

    expect(result).toEqual(defaultPrefs);
    // Should only call from() once (no upsert attempt)
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// updateNotificationPreferences
// ===========================================================================

describe('updateNotificationPreferences', () => {
  const userId = 'user-789';

  it('upserts partial preferences and returns updated row', async () => {
    const updatedPrefs = {
      user_id: userId,
      comments: false,
      likes: true,
      reminders: true,
      timezone: null,
      quiet_hours: null,
    };

    const mockSingle = jest.fn().mockResolvedValue({ data: updatedPrefs, error: null });
    const mockSelect = jest.fn().mockReturnValue({ single: mockSingle });
    const mockUpsert = jest.fn().mockReturnValue({ select: mockSelect });
    mockFrom.mockReturnValue({ upsert: mockUpsert });

    const result = await updateNotificationPreferences(userId, { comments: false });

    expect(result).toEqual(updatedPrefs);
    expect(mockFrom).toHaveBeenCalledWith('notification_preferences');
    expect(mockUpsert).toHaveBeenCalledWith(
      { user_id: userId, comments: false },
      { onConflict: 'user_id' },
    );
  });

  it('throws on supabase error', async () => {
    const dbError = { message: 'constraint violation', code: '23505' };
    const mockSingle = jest.fn().mockResolvedValue({ data: null, error: dbError });
    const mockSelect = jest.fn().mockReturnValue({ single: mockSingle });
    const mockUpsert = jest.fn().mockReturnValue({ select: mockSelect });
    mockFrom.mockReturnValue({ upsert: mockUpsert });

    await expect(
      updateNotificationPreferences(userId, { reminders: false }),
    ).rejects.toEqual(dbError);
  });

  it('only sends specified fields in upsert payload', async () => {
    const mockSingle = jest.fn().mockResolvedValue({
      data: {
        user_id: userId,
        comments: true,
        likes: false,
        reminders: true,
        timezone: 'US/Pacific',
        quiet_hours: null,
      },
      error: null,
    });
    const mockSelect = jest.fn().mockReturnValue({ single: mockSingle });
    const mockUpsert = jest.fn().mockReturnValue({ select: mockSelect });
    mockFrom.mockReturnValue({ upsert: mockUpsert });

    await updateNotificationPreferences(userId, {
      likes: false,
      timezone: 'US/Pacific',
    });

    expect(mockUpsert).toHaveBeenCalledWith(
      { user_id: userId, likes: false, timezone: 'US/Pacific' },
      { onConflict: 'user_id' },
    );
  });
});

// ===========================================================================
// Notification routing + listeners
// ===========================================================================

describe('getNotificationRoute', () => {
  it('routes coach notifications to the coach tab', () => {
    expect(getNotificationRoute({ type: 'coach' })).toBe('/(tabs)/coach');
  });

  it('routes workout reminders from deep links', () => {
    expect(
      getNotificationRoute({
        type: 'workout_reminder',
        deepLink: 'form-factor://scan?templateId=template-123',
      }),
    ).toBe('/(tabs)/scan-arkit?templateId=template-123');
  });

  it('routes social notifications to the notifications modal', () => {
    expect(getNotificationRoute({ type: 'social' })).toBe('/(modals)/notifications');
  });

  it('returns null when no supported route exists', () => {
    expect(getNotificationRoute({ type: 'unknown' })).toBeNull();
  });
});

describe('handleNotificationResponse', () => {
  it('navigates for supported notification payloads', () => {
    const navigate = jest.fn();

    const route = handleNotificationResponse(
      {
        actionIdentifier: Notifications.DEFAULT_ACTION_IDENTIFIER,
        notification: {
          request: {
            content: {
              data: { type: 'coach' },
            },
          },
        },
      } as any,
      navigate,
    );

    expect(route).toBe('/(tabs)/coach');
    expect(navigate).toHaveBeenCalledWith('/(tabs)/coach');
  });

  it('ignores dismissed notification actions', () => {
    const navigate = jest.fn();

    const route = handleNotificationResponse(
      {
        actionIdentifier: dismissedActionIdentifier,
        notification: {
          request: {
            content: {
              data: { type: 'coach' },
            },
          },
        },
      } as any,
      navigate,
    );

    expect(route).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('ignores the explicit rest timer dismiss action', () => {
    const navigate = jest.fn();

    const route = handleNotificationResponse(
      {
        actionIdentifier: 'dismiss',
        notification: {
          request: {
            content: {
              data: { type: 'coach' },
            },
          },
        },
      } as any,
      navigate,
    );

    expect(route).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('push token refresh listener', () => {
  it('re-registers refreshed device tokens and updates cache', async () => {
    const remove = jest.fn();
    let listener: ((token: { data: string }) => Promise<void>) | undefined;
    mockAddPushTokenListener.mockImplementation((callback) => {
      listener = callback;
      return { remove };
    });
    const mockUpsert = jest.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ upsert: mockUpsert });

    startPushTokenRefreshListener('user-123');
    await listener?.({ data: 'ExponentPushToken[rotated]' });

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'ExponentPushToken[rotated]',
        user_id: 'user-123',
      }),
    );
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'ff.notifications.last_token',
      'ExponentPushToken[rotated]',
    );

    stopPushTokenRefreshListener();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('replaces any existing token refresh subscription before starting a new one', () => {
    const firstRemove = jest.fn();
    const secondRemove = jest.fn();
    mockAddPushTokenListener
      .mockReturnValueOnce({ remove: firstRemove })
      .mockReturnValueOnce({ remove: secondRemove });

    startPushTokenRefreshListener('user-123');
    startPushTokenRefreshListener('user-123');

    expect(firstRemove).toHaveBeenCalledTimes(1);

    stopPushTokenRefreshListener();
    expect(secondRemove).toHaveBeenCalledTimes(1);
  });

  it('sync helper starts the listener for an active user and stops it on cleanup', () => {
    const remove = jest.fn();
    mockAddPushTokenListener.mockReturnValue({ remove });

    const cleanup = syncPushTokenRefreshListener('user-123');

    expect(mockAddPushTokenListener).toHaveBeenCalledTimes(1);

    cleanup();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('sync helper stops any existing listener when no active user remains', () => {
    const remove = jest.fn();
    mockAddPushTokenListener.mockReturnValue({ remove });

    syncPushTokenRefreshListener('user-123');
    syncPushTokenRefreshListener(undefined);

    expect(remove).toHaveBeenCalledTimes(1);
    expect(mockAddPushTokenListener).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Module-level side effects
// ===========================================================================

describe('module initialization', () => {
  it('sets the global notification handler on import', () => {
    // Uses captured call count from before beforeEach clears mocks
    expect(notificationHandlerCallCount).toBe(1);
    expect(notificationHandlerArg).toBeDefined();
    expect(notificationHandlerArg).toHaveProperty('handleNotification');
    expect(typeof notificationHandlerArg.handleNotification).toBe('function');
  });

  it('notification handler returns correct defaults', async () => {
    // Uses captured handler arg from before beforeEach clears mocks
    expect(notificationHandlerArg).toBeDefined();
    const result = await notificationHandlerArg.handleNotification();

    expect(result).toEqual({
      shouldPlaySound: false,
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldSetBadge: false,
    });
  });

  it('registers notification categories including rest timer dismiss handling', async () => {
    const notificationCategoryCalls = await initialNotificationCategoryCalls;

    expect(notificationCategoryCalls).toEqual(
      expect.arrayContaining([
        ['social', expect.any(Array)],
        ['coach', expect.any(Array)],
        [
          'rest_timer',
          [
            {
              identifier: 'dismiss',
              buttonTitle: 'Dismiss',
              options: { opensAppToForeground: false },
            },
          ],
          { customDismissAction: true },
        ],
        ['workout_reminder', expect.any(Array)],
      ]),
    );
  });
});
