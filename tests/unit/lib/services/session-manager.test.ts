import { SessionManager } from '@/lib/services/SessionManager';
import type { Session } from '@supabase/supabase-js';

// Mock AsyncStorage (already in setup.ts)
// Mock Platform
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

describe('SessionManager', () => {
  let manager: SessionManager;

  // Helper to create a mock session
  const createMockSession = (overrides: Partial<Session> = {}): Session => ({
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    token_type: 'bearer',
    user: {
      id: 'user-123',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'test@example.com',
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
    ...overrides,
  });

  beforeEach(() => {
    // Get fresh instance (reset singleton for testing)
    manager = SessionManager.getInstance();
    jest.clearAllMocks();
  });

  describe('getInstance', () => {
    it('should return the same instance (singleton)', () => {
      const instance1 = SessionManager.getInstance();
      const instance2 = SessionManager.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('isSessionValid', () => {
    it('should return false for null session', () => {
      expect(manager.isSessionValid(null)).toBe(false);
    });

    it('should return false for session without access_token', () => {
      const session = createMockSession({ access_token: '' });
      expect(manager.isSessionValid(session)).toBe(false);
    });

    it('should return false for session without user', () => {
      const session = createMockSession();
      (session as any).user = null;
      expect(manager.isSessionValid(session)).toBe(false);
    });

    it('should return false for session without user.id', () => {
      const session = createMockSession();
      (session.user as any).id = undefined;
      expect(manager.isSessionValid(session)).toBe(false);
    });

    it('should return true for valid non-expired session', () => {
      const session = createMockSession();
      expect(manager.isSessionValid(session)).toBe(true);
    });

    it('should return false for expired session', () => {
      const session = createMockSession({
        expires_at: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      });
      expect(manager.isSessionValid(session)).toBe(false);
    });

    it('should return true for session with no expires_at', () => {
      const session = createMockSession();
      delete (session as any).expires_at;
      expect(manager.isSessionValid(session)).toBe(true);
    });
  });

  describe('getSessionExpiryInfo', () => {
    it('should return correct expiry info for valid session', () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 3600;
      const session = createMockSession({ expires_at: futureTimestamp });

      const info = manager.getSessionExpiryInfo(session);

      expect(info.isExpired).toBe(false);
      expect(info.timeUntilExpiry).toBeGreaterThan(0);
      expect(info.expiresAt.getTime()).toBe(futureTimestamp * 1000);
    });

    it('should return isExpired true for past expiry', () => {
      const pastTimestamp = Math.floor(Date.now() / 1000) - 3600;
      const session = createMockSession({ expires_at: pastTimestamp });

      const info = manager.getSessionExpiryInfo(session);

      expect(info.isExpired).toBe(true);
      expect(info.timeUntilExpiry).toBeLessThan(0);
    });

    it('should default to 1 hour if no expires_at', () => {
      const session = createMockSession();
      delete (session as any).expires_at;

      const info = manager.getSessionExpiryInfo(session);

      // Should be roughly 1 hour from now (within a few seconds tolerance)
      expect(info.timeUntilExpiry).toBeGreaterThan(3590 * 1000);
      expect(info.timeUntilExpiry).toBeLessThanOrEqual(3600 * 1000);
    });
  });

  describe('shouldRefreshSession', () => {
    it('should return false if session expires in more than 5 minutes', () => {
      const session = createMockSession({
        expires_at: Math.floor(Date.now() / 1000) + 600, // 10 minutes
      });

      expect(manager.shouldRefreshSession(session)).toBe(false);
    });

    it('should return true if session expires in less than 5 minutes', () => {
      const session = createMockSession({
        expires_at: Math.floor(Date.now() / 1000) + 180, // 3 minutes
      });

      expect(manager.shouldRefreshSession(session)).toBe(true);
    });

    it('should return true if session expires in exactly 5 minutes', () => {
      const session = createMockSession({
        expires_at: Math.floor(Date.now() / 1000) + 300, // 5 minutes
      });

      expect(manager.shouldRefreshSession(session)).toBe(true);
    });

    it('should return false if session is already expired', () => {
      const session = createMockSession({
        expires_at: Math.floor(Date.now() / 1000) - 60, // 1 minute ago
      });

      expect(manager.shouldRefreshSession(session)).toBe(false);
    });
  });
});
