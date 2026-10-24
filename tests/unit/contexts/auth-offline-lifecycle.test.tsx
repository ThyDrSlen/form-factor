import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthRetryableFetchError, type Session } from '@supabase/supabase-js';
import { AuthProvider, useAuth } from '@/features/auth/contexts/AuthContext';
import { SessionManager } from '@/lib/services/SessionManager';
import { supabase } from '@/lib/supabase';
import { localDB } from '@/lib/services/database/local-db';
import { syncService } from '@/lib/services/database/sync-service';
import { accountCleanup, AccountCleanupBarrier } from '@/lib/services/database/account-cleanup';
import { unregisterDevicePushToken } from '@/lib/services/notifications';
import { Alert } from 'react-native';

jest.mock('@/lib/services/OAuthHandler', () => ({ OAuthHandler: { getInstance: () => ({}) } }));
jest.mock('@/lib/services/database/local-db', () => ({ localDB: { clearAllData: jest.fn() } }));
jest.mock('@/lib/services/database/sync-service', () => ({ syncService: { cleanupRealtimeSync: jest.fn() } }));
jest.mock('@/lib/services/notifications', () => ({
  registerDevicePushToken: jest.fn(async () => ({ error: null })),
  unregisterDevicePushToken: jest.fn(),
}));
jest.mock('@/lib/services/onboarding', () => ({ clearOnboardingFlag: jest.fn() }));
jest.mock('@/lib/auth-utils', () => ({ signInWithApple: jest.fn() }));
jest.mock('@/lib/network-utils', () => ({ runDiagnostics: jest.fn() }));
jest.mock('expo-linking', () => ({ createURL: () => 'formfactor:///callback' }));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: {
    getSession: jest.fn(), setSession: jest.fn(), refreshSession: jest.fn(),
    signOut: jest.fn(), onAuthStateChange: jest.fn(),
  }, functions: { invoke: jest.fn(async () => ({ data: null, error: null })) } },
}));

const auth = supabase.auth as unknown as Record<string, jest.Mock>;
let authEvent: (event: string, session: Session | null) => unknown;
const wrapper = ({ children }: { children: React.ReactNode }) => <AuthProvider>{children}</AuthProvider>;
const makeSession = (seconds = 120): Session => ({
  access_token: 'access-token-fixture', refresh_token: 'refresh-token-fixture', token_type: 'bearer',
  expires_in: seconds, expires_at: Math.floor(Date.now() / 1000) + seconds,
  user: { id: 'offline-owner', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' },
});
const offlineError = () => new AuthRetryableFetchError('Network request failed', 0);
async function mount() {
  const view = renderHook(() => useAuth(), { wrapper });
  await act(async () => {});
  return view;
}

function useMemoryStorage() {
  const storage = new Map<string, string>();
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => storage.get(key) ?? null);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => { storage.set(key, value); });
  jest.mocked(AsyncStorage.removeItem).mockImplementation(async key => { storage.delete(key); });
  jest.mocked(AsyncStorage.multiRemove).mockImplementation(async keys => { keys.forEach(key => storage.delete(key)); });
  return storage;
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-04T10:00:00Z'));
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  (AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined);
  (AsyncStorage.multiRemove as jest.Mock).mockResolvedValue(undefined);
  // Each test starts a fresh app lifetime. A previous test may deliberately
  // leave the singleton blocked after a deferred SIGNED_OUT/unmount.
  await accountCleanup.run(async () => {});
  jest.clearAllMocks();
  auth.getSession.mockResolvedValue({ data: { session: makeSession() }, error: null });
  auth.refreshSession.mockResolvedValue({ data: { session: null }, error: offlineError() });
  auth.onAuthStateChange.mockImplementation((cb) => {
    authEvent = cb;
    return { data: { subscription: { unsubscribe: jest.fn() } } };
  });
  auth.signOut.mockImplementation(async () => {
    await authEvent('SIGNED_OUT', null);
    return { error: null };
  });
});
afterEach(() => { jest.useRealTimers(); });

describe('AuthProvider offline lifecycle (real provider and SessionManager)', () => {
  it.each(['returned error', 'rejected request'])('keeps failed SDK logout blocked after %s until replacement cleanup', async mode => {
    useMemoryStorage();
    const { result } = await mount();
    const failure = offlineError();
    if (mode === 'returned error') auth.signOut.mockResolvedValue({ error: failure });
    else auth.signOut.mockRejectedValue(failure);
    let outcome: { error?: Error } | undefined;
    await act(async () => { outcome = await result.current.signOut(); });
    expect(outcome?.error).toBe(failure);
    expect(result.current.user).toBeNull();
    await expect(accountCleanup.assertReady()).rejects.toThrow(/cleanup/);
    // The retained SDK session may refresh or emit SIGNED_IN on app focus.
    await act(async () => { authEvent('SIGNED_IN', makeSession()); jest.advanceTimersByTime(0); });
    expect(result.current.user).toBeNull();
    await expect(accountCleanup.assertReady()).rejects.toThrow(/cleanup/);
    const b = { ...makeSession(), user: { ...makeSession().user, id: 'owner-b' } };
    await act(async () => { authEvent('SIGNED_IN', b); jest.advanceTimersByTime(0); });
    expect(localDB.clearAllData).toHaveBeenCalledTimes(2);
    expect(result.current.user?.id).toBe('owner-b');
    await expect(accountCleanup.assertReady()).resolves.toBeUndefined();
  });

  it('keeps timed-out SDK logout durable across remount until confirmed retry', async () => {
    useMemoryStorage();
    const view = await mount();
    auth.signOut.mockImplementation(() => new Promise(() => {}));
    let logout!: ReturnType<typeof view.result.current.signOut>;
    act(() => { logout = view.result.current.signOut(); });
    await act(async () => {});
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    await expect(accountCleanup.assertReady()).rejects.toThrow(/cleanup/);
    let outcome: { error?: Error } | undefined;
    await act(async () => { jest.advanceTimersByTime(1500); outcome = await logout; });
    expect(outcome?.error?.message).toMatch(/timed out/i);
    await expect(new AccountCleanupBarrier().assertReady()).rejects.toThrow(/cleanup/);
    view.unmount();
    const restored = await mount();
    expect(restored.result.current.user).toBeNull();
    expect(restored.result.current.loading).toBe(false);
    expect(auth.getSession).toHaveBeenCalledTimes(1);
    await act(async () => { authEvent('INITIAL_SESSION', makeSession()); jest.advanceTimersByTime(0); });
    expect(restored.result.current.user).toBeNull();
    await expect(accountCleanup.assertReady()).rejects.toThrow(/cleanup/);
    auth.signOut.mockResolvedValue({ error: null });
    await act(async () => { outcome = await restored.result.current.signOut(); });
    expect(outcome?.error).toBeUndefined();
    await expect(new AccountCleanupBarrier().assertReady()).resolves.toBeUndefined();
  });

  it('revokes identity and cleans locally without waiting for push-token networking', async () => {
    const { result } = await mount();
    auth.signOut.mockResolvedValue({ error: null });
    let release!: () => void;
    jest.mocked(unregisterDevicePushToken).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    let logout!: ReturnType<typeof result.current.signOut>;
    act(() => { logout = result.current.signOut(); });
    await act(async () => {});
    try {
      expect(result.current.user).toBeNull();
      expect(localDB.clearAllData).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => { release(); await logout; });
    }
  });

  it('does not publish or save an older cleanup result while a newer transition is blocked', async () => {
    const { result } = await mount();
    const b = { ...makeSession(), user: { ...makeSession().user, id: 'owner-b' } };
    const c = { ...makeSession(), user: { ...makeSession().user, id: 'owner-c' } };
    let release!: () => void;
    (localDB.clearAllData as jest.Mock)
      .mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }))
      .mockRejectedValueOnce(new Error('newer cleanup failed'));
    await act(async () => { authEvent('SIGNED_IN', b); jest.advanceTimersByTime(0); });
    await act(async () => { authEvent('SIGNED_IN', c); jest.advanceTimersByTime(0); });
    await act(async () => { release(); });
    expect(result.current.user).toBeNull();
    expect(result.current.error).toMatch(/cleanup/i);
    expect((AsyncStorage.setItem as jest.Mock).mock.calls.some(([key, value]) =>
      key === '@fitness_app_session' && JSON.parse(value).session.user.id === 'owner-b',
    )).toBe(false);
  });

  it('keeps a failed deletion cleanup blocked until local logout retries it', async () => {
    const { result } = await mount();
    const failure = new Error('deletion cleanup failed');
    (localDB.clearAllData as jest.Mock).mockRejectedValueOnce(failure);
    let outcome: { error?: Error } | undefined;
    await act(async () => { outcome = await result.current.deleteAccount(); });
    expect(supabase.functions.invoke).toHaveBeenCalled();
    expect(outcome?.error).toBeDefined();
    expect(result.current.user).toBeNull();
    expect(result.current.error).toMatch(/cleanup/i);
    await act(async () => { await result.current.signOut(); });
    expect(localDB.clearAllData).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
  });

  it('keeps cleanup pending when saved credential removal fails', async () => {
    const { result } = await mount();
    const incoming = { ...makeSession(), user: { ...makeSession().user, id: 'next-owner' } };
    (AsyncStorage.multiRemove as jest.Mock).mockRejectedValueOnce(new Error('credential storage denied'));
    await act(async () => { authEvent('SIGNED_IN', incoming); jest.advanceTimersByTime(0); });
    expect(result.current.user).toBeNull();
    expect(result.current.error).toMatch(/cleanup/i);
    await act(async () => { authEvent('SIGNED_IN', incoming); jest.advanceTimersByTime(0); });
    expect(result.current.user?.id).toBe('next-owner');
    expect(localDB.clearAllData).toHaveBeenCalledTimes(2);
  });

  it('runs and reports local logout cleanup even without an SDK SIGNED_OUT event', async () => {
    const { result } = await mount();
    auth.signOut.mockResolvedValue({ error: null });
    const failure = new Error('SQLite logout cleanup failed');
    (localDB.clearAllData as jest.Mock).mockRejectedValueOnce(failure);
    let outcome: Awaited<ReturnType<typeof result.current.signOut>> | undefined;
    await act(async () => { outcome = await result.current.signOut(); });
    expect(outcome?.error).toBe(failure);
    expect(result.current.user).toBeNull();
    expect(result.current.error).toMatch(/cleanup/i);
    await act(async () => { outcome = await result.current.signOut(); });
    expect(outcome?.error).toBeUndefined();
    expect(localDB.clearAllData).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
  });

  it('retains a failed cleanup obligation across provider restart before accepting an SDK session', async () => {
    const storage = new Map<string, string>();
    jest.mocked(AsyncStorage.getItem).mockImplementation(async key => storage.get(key) ?? null);
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => { storage.set(key, value); });
    jest.mocked(AsyncStorage.removeItem).mockImplementation(async key => { storage.delete(key); });
    jest.mocked(AsyncStorage.multiRemove).mockImplementation(async keys => { keys.forEach(key => storage.delete(key)); });
    const first = await mount();
    const incoming = { ...makeSession(), user: { ...makeSession().user, id: 'next-owner' } };
    (localDB.clearAllData as jest.Mock).mockRejectedValueOnce(new Error('SQLite cleanup failed'));
    await act(async () => { authEvent('SIGNED_IN', incoming); jest.advanceTimersByTime(0); });
    expect(first.result.current.user).toBeNull();
    first.unmount();
    auth.getSession.mockResolvedValue({ data: { session: incoming }, error: null });
    auth.setSession.mockResolvedValue({ data: { session: incoming }, error: null });
    (localDB.clearAllData as jest.Mock).mockRejectedValueOnce(new Error('SQLite still unavailable'));
    const second = await mount();
    expect(localDB.clearAllData).toHaveBeenCalledTimes(2);
    expect(second.result.current.user).toBeNull();
    expect(second.result.current.error).toBeTruthy();
    await act(async () => { authEvent('SIGNED_IN', incoming); jest.advanceTimersByTime(0); });
    expect(localDB.clearAllData).toHaveBeenCalledTimes(3);
    expect(second.result.current.user?.id).toBe('next-owner');
  });

  it('withholds the new identity and saved credentials when account cleanup fails, then retries', async () => {
    const { result } = await mount();
    const incoming = { ...makeSession(), user: { ...makeSession().user, id: 'next-owner' } };
    (AsyncStorage.setItem as jest.Mock).mockClear();
    (localDB.clearAllData as jest.Mock).mockRejectedValueOnce(new Error('SQLite cleanup failed'));
    await act(async () => { authEvent('SIGNED_IN', incoming); jest.advanceTimersByTime(0); });
    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
    expect(result.current.error).toMatch(/cleanup/i);
    expect((AsyncStorage.setItem as jest.Mock).mock.calls.some(([key, value]) =>
      key === '@fitness_app_session' && JSON.parse(value).session.user.id === 'next-owner',
    )).toBe(false);

    await act(async () => { authEvent('TOKEN_REFRESHED', incoming); jest.advanceTimersByTime(0); });
    expect(localDB.clearAllData).toHaveBeenCalledTimes(2);
    expect(result.current.user?.id).toBe('next-owner');
    expect(result.current.error).toBeNull();
  });

  it('does not restore cached identity for an invalid saved refresh token', async () => {
    const saved = makeSession(-120);
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => key === '@fitness_app_session' ? JSON.stringify({
      session: saved, timestamp: Date.now(), expiresAt: saved.expires_at! * 1000,
    }) : null);
    auth.setSession.mockResolvedValueOnce({ data: { session: null }, error: { code: 'refresh_token_not_found', status: 400 } });
    auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    const { result } = await mount();
    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
    expect(AsyncStorage.multiRemove).toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('cancels expiry work when the provider unmounts', async () => {
    const { unmount } = await mount();
    unmount();
    await act(async () => { jest.advanceTimersByTime(120_000); });
    expect(auth.refreshSession).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(localDB.clearAllData).not.toHaveBeenCalled();
  });

  it.each(['retryable', 'thrown', 'empty'] as const)('preserves data when warning refresh is %s', async (failure) => {
    const alert = jest.spyOn(Alert, 'alert');
    const { result } = await mount();
    if (failure === 'thrown') auth.refreshSession.mockRejectedValueOnce(new TypeError('Network request failed'));
    if (failure === 'empty') auth.refreshSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    await act(async () => { jest.advanceTimersByTime(60_000); });
    const stay = alert.mock.calls[0][2]?.find((button) => button.text === 'Stay logged in');
    expect(stay).toBeDefined();
    await act(async () => { stay?.onPress?.(); });
    expect(result.current.user?.id).toBe('offline-owner');
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(localDB.clearAllData).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('accepts SDK TOKEN_REFRESHED without clearing offline data', async () => {
    const { result } = await mount();
    const renewed = { ...makeSession(3600), access_token: 'rotated-access', refresh_token: 'rotated-refresh' };
    await act(async () => { authEvent('TOKEN_REFRESHED', renewed); jest.advanceTimersByTime(0); });
    expect(result.current.session).toEqual(renewed);
    expect(SessionManager.getInstance().isSessionValid(result.current.session)).toBe(true);
    expect(localDB.clearAllData).not.toHaveBeenCalled();
  });

  it('honors SDK invalid-refresh-token SIGNED_OUT during expiry refresh', async () => {
    const { result } = await mount();
    auth.refreshSession.mockImplementationOnce(async () => {
      authEvent('SIGNED_OUT', null);
      return { data: { session: null }, error: { code: 'refresh_token_not_found', status: 400 } };
    });
    await act(async () => { jest.advanceTimersByTime(120_000); });
    await act(async () => { jest.advanceTimersByTime(1); });
    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
    expect(localDB.clearAllData).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.multiRemove).toHaveBeenCalled();
  });

  it('publishes rotated SDK credentials rather than the expired saved snapshot', async () => {
    const saved = makeSession(-120);
    const renewed = { ...makeSession(3600), access_token: 'rotated-access', refresh_token: 'rotated-refresh' };
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => key === '@fitness_app_session' ? JSON.stringify({
      session: saved, timestamp: Date.now(), expiresAt: saved.expires_at! * 1000,
    }) : null);
    auth.setSession.mockResolvedValueOnce({ data: { session: renewed }, error: null });
    const { result } = await mount();
    expect(result.current.session).toEqual(renewed);
    expect(JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls[0][1]).session).toEqual(renewed);
    expect(auth.refreshSession).not.toHaveBeenCalled();
  });

  it('rejects an expired saved session without refresh credentials even with the recovery opt-in', async () => {
    const saved = { ...makeSession(-120), refresh_token: '' };
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => key === '@fitness_app_session' ? JSON.stringify({
      session: saved, timestamp: Date.now(), expiresAt: saved.expires_at! * 1000,
    }) : null);
    expect(await SessionManager.getInstance().getStoredSession({ allowExpiredForRefresh: true })).toBeNull();
    expect(AsyncStorage.multiRemove).toHaveBeenCalled();
  });

  it('does not publish a late refresh after explicit sign-out', async () => {
    let finishRefresh!: (value: unknown) => void;
    auth.refreshSession.mockImplementationOnce(() => new Promise((resolve) => { finishRefresh = resolve; }));
    const { result } = await mount();
    await act(async () => { jest.advanceTimersByTime(120_000); });
    await act(async () => { await result.current.signOut(); jest.advanceTimersByTime(0); });
    (AsyncStorage.setItem as jest.Mock).mockClear();
    await act(async () => { finishRefresh({ data: { session: makeSession(3600) }, error: null }); });
    expect(result.current.user).toBeNull();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('does not hold the SDK auth lock while invalid-session cleanup runs', async () => {
    const { result } = await mount();
    let finishCleanup!: () => void;
    (syncService.cleanupRealtimeSync as jest.Mock).mockImplementationOnce(() => new Promise<void>((resolve) => { finishCleanup = resolve; }));
    let callbackResult: unknown;
    act(() => { callbackResult = authEvent('SIGNED_OUT', null); });
    expect(callbackResult).toBeUndefined();
    await act(async () => { jest.advanceTimersByTime(0); });
    await act(async () => { finishCleanup(); });
    expect(result.current.user).toBeNull();
    expect(localDB.clearAllData).toHaveBeenCalledTimes(1);
  });

  it('does not treat a null INITIAL_SESSION after failed SDK recovery as sign-out', async () => {
    const { result } = await mount();
    await act(async () => { authEvent('INITIAL_SESSION', null); jest.advanceTimersByTime(0); });
    expect(result.current.user?.id).toBe('offline-owner');
    expect(localDB.clearAllData).not.toHaveBeenCalled();
  });

  it('does not resurrect saved identity after SIGNED_OUT arrives during restore', async () => {
    const saved = makeSession(-120);
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => key === '@fitness_app_session' ? JSON.stringify({
      session: saved, timestamp: Date.now(), expiresAt: saved.expires_at! * 1000,
    }) : null);
    let finishRestore!: (value: unknown) => void;
    auth.setSession.mockImplementationOnce(() => new Promise((resolve) => { finishRestore = resolve; }));
    const { result } = await mount();
    await act(async () => { authEvent('SIGNED_OUT', null); jest.advanceTimersByTime(0); });
    await act(async () => { finishRestore({ data: { session: null }, error: offlineError() }); });
    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
    expect(AsyncStorage.setItem).not.toHaveBeenCalledWith('@fitness_app_session', expect.any(String));
  });

  it('offers expired saved credentials to the SDK and keeps offline identity on retryable restore failure', async () => {
    const saved = makeSession(-120);
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => key === '@fitness_app_session' ? JSON.stringify({
      session: saved, timestamp: Date.now() - 3600_000, expiresAt: saved.expires_at! * 1000,
    }) : null);
    auth.setSession.mockResolvedValue({ data: { session: null }, error: offlineError() });
    auth.getSession.mockResolvedValue({ data: { session: null }, error: offlineError() });
    const { result } = await mount();

    expect(auth.setSession).toHaveBeenCalledWith({ access_token: saved.access_token, refresh_token: saved.refresh_token });
    expect(AsyncStorage.multiRemove).not.toHaveBeenCalled();
    expect(result.current.user?.id).toBe('offline-owner');
    expect(result.current.loading).toBe(false);
    expect(SessionManager.getInstance().isSessionValid(result.current.session)).toBe(false);
    expect(localDB.clearAllData).not.toHaveBeenCalled();
  });
  it('keeps cached identity and local data when the access token expires and refresh is offline', async () => {
    const { result } = await mount();
    const originalSession = result.current.session;
    expect(result.current.user?.id).toBe('offline-owner');
    (AsyncStorage.multiRemove as jest.Mock).mockClear();
    await act(async () => { jest.advanceTimersByTime(120_000); });

    expect(auth.signOut).not.toHaveBeenCalled();
    expect(localDB.clearAllData).not.toHaveBeenCalled();
    expect(AsyncStorage.multiRemove).not.toHaveBeenCalled();
    expect(result.current.user?.id).toBe('offline-owner');
    // Cached identity is not proof of an authorized / unexpired server session.
    expect(SessionManager.getInstance().isSessionValid(originalSession)).toBe(false);
    expect(auth.refreshSession).toHaveBeenCalled();
  });
});
