import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
}));

// SessionManager uses AsyncStorage directly (not Supabase), so the global setup mock is sufficient.

let SessionManager: typeof import('@/lib/services/SessionManager')['SessionManager'];

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    access_token: 'valid-access-token-' + 'x'.repeat(60),
    refresh_token: 'valid-refresh-token-' + 'y'.repeat(30),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    user: {
      id: 'user-abc-123',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'test@example.com',
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    } as Session['user'],
    ...overrides,
  } as Session;
}

describe('SessionManager', () => {
  beforeAll(() => {
    ({ SessionManager } = require('@/lib/services/SessionManager'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the singleton between tests so each gets a fresh instance
    (SessionManager as any).instance = undefined;
  });

  // ---------------------------------------------------------------------------
  // Singleton pattern
  // ---------------------------------------------------------------------------

  describe('getInstance', () => {
    it('returns the same instance on repeated calls', () => {
      const a = SessionManager.getInstance();
      const b = SessionManager.getInstance();
      expect(a).toBe(b);
    });
  });

  // ---------------------------------------------------------------------------
  // storeSession
  // ---------------------------------------------------------------------------

  describe('storeSession', () => {
    it('stores a valid session in AsyncStorage as JSON', async () => {
      const mgr = SessionManager.getInstance();
      const session = makeSession();

      await mgr.storeSession(session);

      expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
      const [key, value] = (AsyncStorage.setItem as jest.Mock).mock.calls[0];
      expect(key).toBe('@fitness_app_session');
      const parsed = JSON.parse(value);
      expect(parsed.session).toMatchObject({ access_token: session.access_token });
      expect(parsed.timestamp).toBeGreaterThan(0);
      expect(parsed.expiresAt).toBeGreaterThan(Date.now() - 5000);
    });

    it('uses session.expires_at when present (converted to ms)', async () => {
      const mgr = SessionManager.getInstance();
      const expiresAtSec = Math.floor(Date.now() / 1000) + 7200;
      const session = makeSession({ expires_at: expiresAtSec });

      await mgr.storeSession(session);

      const stored = JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls[0][1]);
      expect(stored.expiresAt).toBe(expiresAtSec * 1000);
    });

    it('defaults to 1 hour expiry when session.expires_at is undefined', async () => {
      const mgr = SessionManager.getInstance();
      const session = makeSession({ expires_at: undefined });

      const before = Date.now();
      await mgr.storeSession(session);

      const stored = JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls[0][1]);
      // Should be approximately now + 1h
      expect(stored.expiresAt).toBeGreaterThanOrEqual(before + 60 * 60 * 1000 - 100);
      expect(stored.expiresAt).toBeLessThanOrEqual(Date.now() + 60 * 60 * 1000 + 100);
    });

    it('throws when AsyncStorage.setItem fails', async () => {
      const mgr = SessionManager.getInstance();
      (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('Disk full'));

      await expect(mgr.storeSession(makeSession())).rejects.toThrow('Failed to store session');
    });
  });

  // ---------------------------------------------------------------------------
  // getStoredSession
  // ---------------------------------------------------------------------------

  describe('getStoredSession', () => {
    it('returns the session when stored data is valid and not expired', async () => {
      const mgr = SessionManager.getInstance();
      const session = makeSession();
      const storedData = {
        session,
        timestamp: Date.now(),
        expiresAt: Date.now() + 3600_000,
      };
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(storedData));

      const result = await mgr.getStoredSession();

      expect(result).toMatchObject({ access_token: session.access_token });
    });

    it('returns null when no stored session exists', async () => {
      const mgr = SessionManager.getInstance();
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

      const result = await mgr.getStoredSession();

      expect(result).toBeNull();
    });

    it('returns null and clears when stored session is expired', async () => {
      const mgr = SessionManager.getInstance();
      const session = makeSession();
      const storedData = {
        session,
        timestamp: Date.now() - 7200_000,
        expiresAt: Date.now() - 1000, // expired 1s ago
      };
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(storedData));

      const result = await mgr.getStoredSession();

      expect(result).toBeNull();
      expect(AsyncStorage.multiRemove).toHaveBeenCalled();
    });

    it('returns null and clears when stored JSON is corrupted', async () => {
      const mgr = SessionManager.getInstance();
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue('not valid json {{{');

      const result = await mgr.getStoredSession();

      expect(result).toBeNull();
      expect(AsyncStorage.multiRemove).toHaveBeenCalled();
    });

    it('returns null and clears when session structure is invalid (missing access_token)', async () => {
      const mgr = SessionManager.getInstance();
      const storedData = {
        session: { user: { id: 'u1' } }, // missing access_token
        timestamp: Date.now(),
        expiresAt: Date.now() + 3600_000,
      };
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(storedData));

      const result = await mgr.getStoredSession();

      expect(result).toBeNull();
      expect(AsyncStorage.multiRemove).toHaveBeenCalled();
    });

    it('returns null and clears when session structure is invalid (empty access_token)', async () => {
      const mgr = SessionManager.getInstance();
      const storedData = {
        session: { access_token: '', user: { id: 'u1' } },
        timestamp: Date.now(),
        expiresAt: Date.now() + 3600_000,
      };
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(storedData));

      const result = await mgr.getStoredSession();

      expect(result).toBeNull();
    });

    it('returns null and clears when session has no user', async () => {
      const mgr = SessionManager.getInstance();
      const storedData = {
        session: { access_token: 'valid-token-long-enough-here' },
        timestamp: Date.now(),
        expiresAt: Date.now() + 3600_000,
      };
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(storedData));

      const result = await mgr.getStoredSession();

      expect(result).toBeNull();
    });

    it('returns null on web platform without touching AsyncStorage', async () => {
      const mgr = SessionManager.getInstance();
      const originalOS = Platform.OS;
      Object.defineProperty(Platform, 'OS', { value: 'web', writable: true });

      const result = await mgr.getStoredSession();

      expect(result).toBeNull();
      expect(AsyncStorage.getItem).not.toHaveBeenCalled();

      Object.defineProperty(Platform, 'OS', { value: originalOS, writable: true });
    });

    it('clears and returns null when AsyncStorage.getItem throws', async () => {
      const mgr = SessionManager.getInstance();
      (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('IO error'));

      const result = await mgr.getStoredSession();

      expect(result).toBeNull();
      expect(AsyncStorage.multiRemove).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // clearSession
  // ---------------------------------------------------------------------------

  describe('clearSession', () => {
    it('removes both session keys from AsyncStorage', async () => {
      const mgr = SessionManager.getInstance();
      await mgr.clearSession();

      expect(AsyncStorage.multiRemove).toHaveBeenCalledWith([
        '@fitness_app_session',
        '@fitness_app_session_timestamp',
      ]);
    });

    it('does not throw when AsyncStorage.multiRemove fails', async () => {
      const mgr = SessionManager.getInstance();
      (AsyncStorage.multiRemove as jest.Mock).mockRejectedValueOnce(new Error('IO error'));

      // Should not throw
      await expect(mgr.clearSession()).resolves.toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // isSessionValid
  // ---------------------------------------------------------------------------

  describe('isSessionValid', () => {
    it('returns false for null', () => {
      const mgr = SessionManager.getInstance();
      expect(mgr.isSessionValid(null)).toBe(false);
    });

    it('returns false for a session missing access_token', () => {
      const mgr = SessionManager.getInstance();
      const bad = { user: { id: 'u1' } } as unknown as Session;
      expect(mgr.isSessionValid(bad)).toBe(false);
    });

    it('returns false for a session with empty access_token', () => {
      const mgr = SessionManager.getInstance();
      const bad = { access_token: '', user: { id: 'u1' } } as unknown as Session;
      expect(mgr.isSessionValid(bad)).toBe(false);
    });

    it('returns false for an expired session', () => {
      const mgr = SessionManager.getInstance();
      const expired = makeSession({ expires_at: Math.floor(Date.now() / 1000) - 60 });
      expect(mgr.isSessionValid(expired)).toBe(false);
    });

    it('returns true for a valid, non-expired session', () => {
      const mgr = SessionManager.getInstance();
      const session = makeSession();
      expect(mgr.isSessionValid(session)).toBe(true);
    });

    it('returns true for a session with no expires_at', () => {
      const mgr = SessionManager.getInstance();
      const session = makeSession({ expires_at: undefined });
      expect(mgr.isSessionValid(session)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // getSessionExpiryInfo
  // ---------------------------------------------------------------------------

  describe('getSessionExpiryInfo', () => {
    it('calculates correct expiry info for a future session', () => {
      const mgr = SessionManager.getInstance();
      const expiresAtSec = Math.floor(Date.now() / 1000) + 3600;
      const session = makeSession({ expires_at: expiresAtSec });

      const info = mgr.getSessionExpiryInfo(session);

      expect(info.expiresAt).toBeInstanceOf(Date);
      expect(info.isExpired).toBe(false);
      expect(info.timeUntilExpiry).toBeGreaterThan(3500_000);
      expect(info.timeUntilExpiry).toBeLessThanOrEqual(3600_000);
    });

    it('reports expired for a past session', () => {
      const mgr = SessionManager.getInstance();
      const expiresAtSec = Math.floor(Date.now() / 1000) - 60;
      const session = makeSession({ expires_at: expiresAtSec });

      const info = mgr.getSessionExpiryInfo(session);

      expect(info.isExpired).toBe(true);
      expect(info.timeUntilExpiry).toBeLessThan(0);
    });

    it('defaults to 1 hour when expires_at is missing', () => {
      const mgr = SessionManager.getInstance();
      const session = makeSession({ expires_at: undefined });

      const before = Date.now();
      const info = mgr.getSessionExpiryInfo(session);

      // expiresAt should be approximately 1 hour from now
      const expectedMs = before + 3600_000;
      expect(info.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMs - 500);
      expect(info.expiresAt.getTime()).toBeLessThanOrEqual(expectedMs + 500);
      expect(info.isExpired).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // shouldRefreshSession
  // ---------------------------------------------------------------------------

  describe('shouldRefreshSession', () => {
    it('returns true when session expires within 5 minutes', () => {
      const mgr = SessionManager.getInstance();
      // Expires in 3 minutes
      const expiresAtSec = Math.floor(Date.now() / 1000) + 180;
      const session = makeSession({ expires_at: expiresAtSec });

      expect(mgr.shouldRefreshSession(session)).toBe(true);
    });

    it('returns false when session has more than 5 minutes remaining', () => {
      const mgr = SessionManager.getInstance();
      // Expires in 10 minutes
      const expiresAtSec = Math.floor(Date.now() / 1000) + 600;
      const session = makeSession({ expires_at: expiresAtSec });

      expect(mgr.shouldRefreshSession(session)).toBe(false);
    });

    it('returns false when session is already expired', () => {
      const mgr = SessionManager.getInstance();
      const expiresAtSec = Math.floor(Date.now() / 1000) - 60;
      const session = makeSession({ expires_at: expiresAtSec });

      // timeUntilExpiry is negative, so > 0 check fails
      expect(mgr.shouldRefreshSession(session)).toBe(false);
    });

    it('returns true at the exact 5-minute boundary', () => {
      const mgr = SessionManager.getInstance();
      // Expires in exactly 5 minutes (300s)
      const expiresAtSec = Math.floor(Date.now() / 1000) + 300;
      const session = makeSession({ expires_at: expiresAtSec });

      // timeUntilExpiry <= 5min AND > 0 -> true
      expect(mgr.shouldRefreshSession(session)).toBe(true);
    });
  });
});
