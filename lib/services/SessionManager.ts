import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const SESSION_STORAGE_KEY = '@fitness_app_session';
const SESSION_TIMESTAMP_KEY = '@fitness_app_session_timestamp';

interface StoredSession {
  session: Session;
  timestamp: number;
  expiresAt: number;
}

export class SessionManager {
  private static instance: SessionManager;

  static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  /**
   * Store a session securely in AsyncStorage
   */
  async storeSession(session: Session): Promise<void> {
    try {
      const now = Date.now();
      const expiresAt = session.expires_at ? session.expires_at * 1000 : now + (60 * 60 * 1000); // Default 1 hour

      const storedSession: StoredSession = {
        session,
        timestamp: now,
        expiresAt,
      };

      console.log('[SessionManager] Storing session:', {
        userId: session.user?.id,
        expiresAt: new Date(expiresAt).toISOString(),
        hasRefreshToken: !!session.refresh_token,
      });

      // Store session data
      await AsyncStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(storedSession));
      
      console.log('[SessionManager] Session stored successfully');
    } catch (error) {
      console.error('[SessionManager] Error storing session:', error);
      throw new Error('Failed to store session');
    }
  }

  /**
   * Retrieve a stored session from AsyncStorage
   */
  async getStoredSession(): Promise<Session | null> {
    try {
      // On web, we don't use AsyncStorage - let Supabase handle it
      if (Platform.OS === 'web') {
        console.log('[SessionManager] Web platform - skipping AsyncStorage retrieval');
        return null;
      }

      const storedData = await AsyncStorage.getItem(SESSION_STORAGE_KEY);
      
      if (!storedData) {
        console.log('[SessionManager] No stored session found');
        return null;
      }

      const parsedData: StoredSession = JSON.parse(storedData);
      const { session, timestamp, expiresAt } = parsedData;

      console.log('[SessionManager] Found stored session:', {
        userId: session.user?.id,
        storedAt: new Date(timestamp).toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
        isExpired: Date.now() > expiresAt,
      });

      // Check if session is expired
      if (Date.now() > expiresAt) {
        console.log('[SessionManager] Stored session is expired, clearing it');
        await this.clearSession();
        return null;
      }

      // Validate session structure
      if (!this.isValidSession(session)) {
        console.log('[SessionManager] Stored session is invalid, clearing it');
        await this.clearSession();
        return null;
      }

      console.log('[SessionManager] Retrieved valid session');
      return session;
    } catch (error) {
      console.error('[SessionManager] Error retrieving session:', error);
      // Clear corrupted session data
      await this.clearSession();
      return null;
    }
  }

  /**
   * Clear stored session data
   */
  async clearSession(): Promise<void> {
    try {
      console.log('[SessionManager] Clearing stored session');
      await AsyncStorage.multiRemove([SESSION_STORAGE_KEY, SESSION_TIMESTAMP_KEY]);
      console.log('[SessionManager] Session cleared successfully');
    } catch (error) {
      console.error('[SessionManager] Error clearing session:', error);
      // Don't throw here - clearing should always succeed
    }
  }

  /**
   * Check if a session is valid and not expired
   */
  isSessionValid(session: Session | null): boolean {
    if (!session) {
      return false;
    }

    // Check basic session structure
    if (!this.isValidSession(session)) {
      return false;
    }

    // Check if session is expired
    if (session.expires_at) {
      const expiresAt = session.expires_at * 1000; // Convert to milliseconds
      const now = Date.now();
      const isExpired = now >= expiresAt;
      
      console.log('[SessionManager] Session expiry check:', {
        expiresAt: new Date(expiresAt).toISOString(),
        now: new Date(now).toISOString(),
        isExpired,
      });

      return !isExpired;
    }

    // If no expiry time, consider it valid (shouldn't happen with Supabase)
    console.log('[SessionManager] Session has no expiry time - considering valid');
    return true;
  }

  /**
   * Validate session structure
   */
  private isValidSession(session: any): session is Session {
    return (
      session &&
      typeof session === 'object' &&
      typeof session.access_token === 'string' &&
      session.access_token.length > 0 &&
      session.user &&
      typeof session.user.id === 'string'
    );
  }

  /**
   * Get session expiry information
   */
  getSessionExpiryInfo(session: Session): { expiresAt: Date; isExpired: boolean; timeUntilExpiry: number } {
    const expiresAt = session.expires_at ? new Date(session.expires_at * 1000) : new Date(Date.now() + 60 * 60 * 1000);
    const now = new Date();
    const isExpired = now >= expiresAt;
    const timeUntilExpiry = expiresAt.getTime() - now.getTime();

    return {
      expiresAt,
      isExpired,
      timeUntilExpiry,
    };
  }

  /**
   * Check if session needs refresh (expires within 5 minutes)
   */
  shouldRefreshSession(session: Session): boolean {
    const { timeUntilExpiry } = this.getSessionExpiryInfo(session);
    const fiveMinutes = 5 * 60 * 1000; // 5 minutes in milliseconds
    
    return timeUntilExpiry <= fiveMinutes && timeUntilExpiry > 0;
  }
}