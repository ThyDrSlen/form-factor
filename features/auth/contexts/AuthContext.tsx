import { OAuthHandler } from '@/lib/services/OAuthHandler';
import { createError, mapToUserMessage, logError } from '@/lib/services/ErrorHandler';
import { clearOnboardingFlag } from '@/lib/services/onboarding';
import { AuthError, isAuthRetryableFetchError, Session, User } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { SessionManager } from '@/lib/services/SessionManager';
import { supabase } from '@/lib/supabase';
import { runDiagnostics } from '@/lib/network-utils';
import { signInWithApple as nativeAppleSignIn } from '@/lib/auth-utils';
import { localDB } from '@/lib/services/database/local-db';
import { syncService } from '@/lib/services/database/sync-service';
import { accountCleanup, type AccountCleanupOptions } from '@/lib/services/database/account-cleanup';
import { registerDevicePushToken, unregisterDevicePushToken } from '@/lib/services/notifications';

// In Expo Router, group folders like (auth) are omitted from the URL path.
// The file app/(auth)/callback.tsx resolves to '/callback', not '/auth/callback'.
const redirectUrl = Linking.createURL('callback');
const SESSION_WARNING_LEAD_MS = 60 * 1000;

// Mock user data for development
const MOCK_USER: User = {
  id: 'mock-user-123',
  app_metadata: { provider: 'mock' },
  user_metadata: {
    name: 'Test User',
    email: 'test@example.com',
    picture: 'https://ui-avatars.com/api/?name=Test+User&background=6C63FF&color=fff',
  },
  email: 'test@example.com',
  created_at: new Date().toISOString(),
  aud: 'authenticated',
  role: 'authenticated',
  confirmed_at: new Date().toISOString(),
  last_sign_in_at: new Date().toISOString(),
} as User;

const MOCK_SESSION: Session = {
  access_token: 'mock-access-token',
  refresh_token: 'mock-refresh-token',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  expires_in: 3600,
  token_type: 'bearer',
  user: MOCK_USER,
} as Session;

// Small helper to cap how long we wait for a promise (e.g., network sign-out)
async function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout?: () => void): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => {
          onTimeout?.();
          resolve(undefined);
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type AuthContextType = {
  user: User | null;
  session: Session | null;
  /** Check this publication against the latest synchronously observed auth revision. */
  isAuthStateCurrent: () => boolean;
  loading: boolean;
  isSigningIn: boolean;
  isMockUser: boolean;
  error: string | null;
  signInWithGoogle: () => Promise<{ error?: AuthError }>;
  signInWithApple: () => Promise<{ error?: AuthError }>;
  signInWithEmail: (email: string, password: string) => Promise<{ error?: AuthError }>;
  signInWithMagicLink: (email: string) => Promise<{ error?: AuthError }>;
  signUpWithEmail: (email: string, password: string, userData?: { fullName?: string }) => Promise<{ error?: AuthError }>;
  resetPassword: (email: string) => Promise<{ error?: AuthError }>;
  updateProfile: (updates: { fullName?: string }) => Promise<{ error?: AuthError | Error }>;
  signOut: () => Promise<{ error?: Error }>;
  deleteAccount: () => Promise<{ error?: Error }>;
  handleAuthCallback: (url: string) => Promise<void>;
  clearError: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isMockUser, setIsMockUser] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previousUserIdRef = useRef<string | null>(null);
  // Invalidate pending bootstrap/refresh results when authoritative auth changes.
  const authRevisionRef = useRef(0);
  const [publishedAuthRevision, setPublishedAuthRevision] = useState(0);
  const isAuthStateCurrent = useCallback(
    () => publishedAuthRevision === authRevisionRef.current,
    [publishedAuthRevision],
  );
  const warningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expiryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sessionManager = SessionManager.getInstance();
  const oauthHandler = OAuthHandler.getInstance();

  // Clear error helper
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const clearSessionTimers = useCallback(() => {
    if (warningTimeoutRef.current) {
      clearTimeout(warningTimeoutRef.current);
      warningTimeoutRef.current = null;
    }

    if (expiryTimeoutRef.current) {
      clearTimeout(expiryTimeoutRef.current);
      expiryTimeoutRef.current = null;
    }
  }, []);

  // A3: guarantee session-warning/expiry timers are cleared on provider
  // unmount. Previously these were cleared only when the session-watcher
  // effect re-ran — if the provider itself unmounted (sign-out, app reload
  // during tests), the timeouts could still fire and Alert into a dead
  // tree or call signOut against an unmounted React root.
  useEffect(() => {
    return () => {
      clearSessionTimers();
    };
  }, [clearSessionTimers]);

  const cleanupAccountData = useCallback((options?: AccountCleanupOptions, afterCleanup?: () => Promise<void>) => accountCleanup.run(async () => {
    await syncService.cleanupRealtimeSync();
    await localDB.clearAllData();
    await sessionManager.clearSession({ throwOnError: true });
    await afterCleanup?.();
  }, options), [sessionManager]);

  // Helper to update auth state
  const updateAuthState = useCallback(async (
    newSession: Session | null,
    source: string,
    revision = authRevisionRef.current,
  ) => {
    try {
      console.log(`[Auth] Updating auth state from ${source}:`, {
        hasSession: !!newSession,
        userId: newSession?.user?.id
      });

      const previousUserId = previousUserIdRef.current;
      const newUserId = newSession?.user?.id ?? null;
      const userChanged = Boolean(previousUserId && newUserId && previousUserId !== newUserId);
      const signedOut = Boolean(previousUserId && !newUserId);

      const logoutOwner = await accountCleanup.getPendingLogoutOwner();
      if (logoutOwner && newUserId && (logoutOwner === newUserId || logoutOwner === '*')) {
        // SDK refresh/focus events are not a successful logout or new identity.
        setUser(null);
        setSession(null);
        setError('Sign-out is pending. Please retry signing out.');
        setLoading(false);
        return;
      }
      const resolveLogout = Boolean(logoutOwner && (
        newUserId || source === 'auth_event_SIGNED_OUT'
      ));

      if (userChanged || signedOut || await accountCleanup.isPending()) {
        await cleanupAccountData({ resolveLogout });
      }

      // A newer transition may have invalidated this cleanup while it awaited
      // storage. Its completion is not permission to publish another identity.
      if (accountCleanup.isBlocked) {
        setUser(null);
        setSession(null);
        return;
      }

      setSession(newSession);
      setUser(newSession ? newSession.user : null);
      setPublishedAuthRevision(revision);
      setError(null);

      previousUserIdRef.current = newUserId;

      // Store or clear session based on state
      if (newSession && !isMockUser) {
        await sessionManager.storeSession(newSession);
      } else if (!newSession) {
        await sessionManager.clearSession();
      }

      setLoading(false);
    } catch (error) {
      console.error('[Auth] Error updating auth state:', error);
      // Retain the previous owner as a cleanup obligation for the next event.
      setUser(null);
      setSession(null);
      setError('Account cleanup failed. Please retry signing in or signing out.');
      setLoading(false);
      throw error;
    }
  }, [sessionManager, isMockUser, cleanupAccountData]);

  // Initialize auth state
  useEffect(() => {
    let mounted = true;
    const initialRevision = authRevisionRef.current;
    const isCurrent = () => mounted && initialRevision === authRevisionRef.current;
    const pendingEvents = new Set<ReturnType<typeof setTimeout>>();
    let eventUpdates = Promise.resolve();

    const initializeAuth = async () => {
      try {
        console.log('[Auth] Initializing authentication...');

        // Retry an interrupted transition before reading saved/SDK credentials.
        if (await accountCleanup.isPending()) await cleanupAccountData();
        if (!isCurrent()) return;
        if (accountCleanup.isBlocked) {
          setUser(null);
          setSession(null);
          setError('Sign-out is pending. Please retry signing out.');
          setLoading(false);
          return;
        }

        // First, try to get stored session
        const storedSession = await sessionManager.getStoredSession({ allowExpiredForRefresh: true });
        if (!isCurrent()) return;

        if (storedSession) {
          console.log('[Auth] Restoring saved credentials through Supabase');

          // The SDK may refresh an expired token. A saved identity is never
          // used to authorize server operations in place of the SDK session.
          const { data, error } = await supabase.auth.setSession({
            access_token: storedSession.access_token,
            refresh_token: storedSession.refresh_token,
          });

          if (!isCurrent()) return;
          if (error && isAuthRetryableFetchError(error)) {
            await updateAuthState(storedSession, 'offline_cached_session');
            return;
          }
          if (error) {
            console.error('[Auth] Error setting stored session:', error);
            await sessionManager.clearSession();
          } else if (mounted) {
            await updateAuthState(data?.session ?? storedSession, 'stored_session');
            return; // Exit early if we successfully restored session
          }
        }

        // If no valid stored session, check Supabase's current session
        const { data: { session: currentSession } } = await supabase.auth.getSession();

        if (isCurrent()) {
          await updateAuthState(currentSession, 'supabase_session');
        }
      } catch (error) {
        console.error('[Auth] Error initializing auth:', error);
        if (isCurrent()) {
          setLoading(false);
          setError('Failed to initialize authentication');
        }
      }
    };

    initializeAuth();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;

      console.log(`[Auth] Auth state changed:`, { event, hasSession: !!session });

      // Don't override mock user state
      if (isMockUser && event !== 'SIGNED_OUT') {
        return;
      }
      // INITIAL_SESSION can be null when SDK recovery cannot reach the network;
      // initialization owns that case. Only SIGNED_OUT revokes cached identity.
      if (!session && event !== 'SIGNED_OUT') return;
      const revision = ++authRevisionRef.current;
      if (event === 'SIGNED_OUT' || (previousUserIdRef.current && previousUserIdRef.current !== session?.user.id)) {
        accountCleanup.block();
      }

      // Supabase awaits this callback while holding its auth lock. Cleanup can
      // re-enter auth via realtime, so run ordered work after releasing the lock.
      const timer = setTimeout(() => {
        pendingEvents.delete(timer);
        eventUpdates = eventUpdates.then(async () => {
          if (mounted) await updateAuthState(session, `auth_event_${event}`, revision);
        }).catch(() => { /* Already reported; keep later cleanup retries runnable. */ });
      }, 0);
      pendingEvents.add(timer);
    });

    return () => {
      mounted = false;
      authRevisionRef.current += 1;
      pendingEvents.forEach(clearTimeout);
      subscription?.unsubscribe();
    };
  }, [updateAuthState, sessionManager, isMockUser, cleanupAccountData]);

  // Refresh push token when a real user signs in
  useEffect(() => {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const registerPushTokenWithRetry = async (userId: string) => {
      const delaysMs = [1000, 2000, 4000];

      for (let attempt = 0; attempt < delaysMs.length; attempt++) {
        await wait(delaysMs[attempt]);

        try {
          const result = await registerDevicePushToken(userId, { requestPermission: false });
          if (!result.error) {
            return;
          }

          console.warn('[Auth] Push token registration warning:', result.error, { attempt: attempt + 1 });
        } catch (err) {
          console.warn('[Auth] Failed to register push token:', err, { attempt: attempt + 1 });
        }
      }
    };

    const syncPushToken = async () => {
      if (!user || isMockUser) return;

      await registerPushTokenWithRetry(user.id);
    };

    void syncPushToken();
  }, [user?.id, isMockUser]);

  const handleAuthCallback = useCallback(async (url: string): Promise<void> => {
    try {
      console.log('[Auth] Handling auth callback with OAuthHandler');
      
      const session = await oauthHandler.handleCallback(url);
      
      if (session) {
        console.log('[Auth] Callback handled successfully, session created');
        await updateAuthState(session, 'oauth_callback');
      } else {
        const appErr = createError('oauth', 'TOKEN_EXTRACT_FAILED', 'Failed to create session from callback', {
          retryable: true,
          severity: 'warning',
        });
        logError(appErr, { feature: 'auth', location: 'handleAuthCallback' });
        setError(mapToUserMessage(appErr));
      }
    } catch (error) {
      const appErr = createError('oauth', 'OAUTH_CALLBACK_ERROR', error instanceof Error ? error.message : 'Authentication failed', {
        retryable: true,
        severity: 'error',
        details: error,
      });
      logError(appErr, { feature: 'auth', location: 'handleAuthCallback' });
      setError(mapToUserMessage(appErr));
      throw error;
    }
  }, [oauthHandler, updateAuthState]);



  const signInWithMock = useCallback(async () => {
    try {
      setIsSigningIn(true);
      setIsMockUser(true);

      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 1000));

      setUser(MOCK_USER);
      setSession(MOCK_SESSION);
      setLoading(false);

      return {};
    } catch (error) {
      console.error('[Auth] Error in signInWithMock:', error);
      return { error: error as AuthError };
    } finally {
      setIsSigningIn(false);
    }
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (process.env.EXPO_PUBLIC_USE_MOCK_AUTH === 'true') {
      console.log('[Auth] Using mock Google sign in (EXPO_PUBLIC_USE_MOCK_AUTH)');
      return signInWithMock();
    }

    try {
      setIsSigningIn(true);
      setError(null);

      console.log('[Auth] Starting Google OAuth with OAuthHandler');
      const result = await oauthHandler.initiateOAuth('google');

      if (result.success && result.session) {
        console.log('[Auth] Google OAuth successful');
        await updateAuthState(result.session, 'google_oauth');
        return {};
      } else {
        const appErr = createError('oauth', 'OAUTH_START_FAILED', result.error || 'Google sign-in failed', {
          retryable: true,
          severity: 'warning',
          details: result,
        });
        logError(appErr, { feature: 'auth', location: 'signInWithGoogle' });
        setError(mapToUserMessage(appErr));
        return { 
          error: { 
            message: result?.error || 'Google sign-in failed', 
            status: 500 
          } as AuthError 
        };
      }
    } catch (error) {
      const appErr = createError('oauth', 'OAUTH_EXCEPTION', error instanceof Error ? error.message : 'An unexpected error occurred', {
        retryable: true,
        severity: 'error',
        details: error,
      });
      logError(appErr, { feature: 'auth', location: 'signInWithGoogle' });
      setError(mapToUserMessage(appErr));
      return { 
        error: { 
          message: appErr.message, 
          status: 500 
        } as AuthError 
      };
    } finally {
      setIsSigningIn(false);
    }
  }, [signInWithMock, oauthHandler, updateAuthState]);

  /**
   * Sign in with Apple OAuth provider
   * Note: Apple Sign-In is only available on iOS 13+
   */
  const signInWithApple = useCallback(async () => {
    try {
      setIsSigningIn(true);
      setError(null);

      console.log('[Auth] Starting native Apple sign in');
      const result = await nativeAppleSignIn();

      if (!result) {
        // Likely cancelled by user
        return { error: { message: 'Sign-in was cancelled', status: 0 } as AuthError };
      }

      if (result.session) {
        await updateAuthState(result.session, 'apple_oauth');
      }

      return {};
    } catch (error) {
      const appErr = createError('oauth', 'OAUTH_EXCEPTION', error instanceof Error ? error.message : 'An unexpected error occurred', {
        retryable: true,
        severity: 'error',
        details: error,
      });
      logError(appErr, { feature: 'auth', location: 'signInWithApple' });
      setError(mapToUserMessage(appErr));
      return { 
        error: { 
          message: appErr.message, 
          status: 500 
        } as AuthError 
      };
    } finally {
      setIsSigningIn(false);
    }
  }, [updateAuthState]);

  const signOut = useCallback(async () => {
    const revision = ++authRevisionRef.current;
    const currentUserId = user?.id ?? previousUserIdRef.current;

    try {
      console.log('[Auth] Signing out user');
      clearSessionTimers();

      if (isMockUser) {
        console.log('[Auth] Signing out mock user');
        setUser(null);
        setSession(null);
        setPublishedAuthRevision(revision);
        setIsMockUser(false);
        await sessionManager.clearSession();
        return {};
      }

      accountCleanup.block();

      // Revoke UI access immediately, but do not report success or forget the
      // durable cleanup obligation until local cleanup has actually completed.
      setUser(null);
      setSession(null);
      setPublishedAuthRevision(revision);
      setError(null);
      const logoutOwner = currentUserId ?? await accountCleanup.getPendingLogoutOwner() ?? '*';
      await cleanupAccountData({ logoutOwner, resolveLogout: true }, async () => {
        await clearOnboardingFlag();
        // Cleanup and its durable marker precede all network housekeeping.
        if (currentUserId) {
          try {
            await withTimeout(unregisterDevicePushToken(currentUserId), 1500);
          } catch (cleanupError) {
            console.warn('[Auth] Failed to unregister push token on sign-out:', cleanupError);
          }
        }
        const result = await withTimeout(supabase.auth.signOut(), 1500);
        if (!result) throw new Error('Sign-out timed out. Please retry signing out.');
        if (result.error) throw result.error;
      });
      // An SDK event can supersede this attempt while the request is pending.
      // That event owns final publication and any further cleanup.
      if (revision === authRevisionRef.current && !accountCleanup.isBlocked) {
        previousUserIdRef.current = null;
      }

      return {};
    } catch (error) {
      console.error('[Auth] Error in signOut:', error);
      if (revision === authRevisionRef.current) {
        setError('Account cleanup or sign-out failed. Please retry signing out.');
        setLoading(false);
      }
      return { error: error as Error };
    }
  }, [clearSessionTimers, isMockUser, sessionManager, user, cleanupAccountData]);

  const deleteAccount = useCallback(async () => {
    try {
      console.log('[Auth] Deleting account');

      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession) {
        return { error: new Error('No active session') };
      }

      const { error: fnError } = await supabase.functions.invoke('delete-account', {
        headers: { Authorization: `Bearer ${currentSession.access_token}` },
      });

      if (fnError) {
        throw fnError;
      }

      // Server deletion does not prove the device cache was cleared. Use the
      // same durable cleanup/retry boundary as explicit logout.
      return await signOut();
    } catch (error) {
      console.error('[Auth] Error deleting account:', error);
      const appErr = createError('auth', 'DELETE_ACCOUNT_FAILED', error instanceof Error ? error.message : 'Failed to delete account', {
        retryable: false,
        severity: 'error',
        details: error,
      });
      logError(appErr, { feature: 'auth', location: 'deleteAccount' });
      return { error: error as Error };
    }
  }, [signOut]);

  const refreshSessionForTimeout = useCallback(async () => {
    const revision = authRevisionRef.current;
    try {
      const { data, error } = await supabase.auth.refreshSession();
      // Auth events (including TOKEN_REFRESHED) own newer state. A late result
      // must not resurrect a signed-out user or overwrite a rotated token.
      if (revision !== authRevisionRef.current) return;

      if (error || !data.session) {
        // Token expiry / a transport failure is not a logout. The SDK retains
        // retryable sessions and emits SIGNED_OUT for invalid refresh tokens.
        console.warn('[Auth] Session refresh unavailable; retaining offline state:', error);
        return;
      }

      await updateAuthState(data.session, 'session_warning_refresh');
      setError(null);
    } catch (error) {
      console.warn('[Auth] Session refresh unavailable; retaining offline state:', error);
    }
  }, [updateAuthState]);

  useEffect(() => {
    clearSessionTimers();

    if (!session || isMockUser || !session.expires_at) {
      return;
    }

    const now = Date.now();
    const expiresAtMs = session.expires_at * 1000;
    const msUntilExpiry = expiresAtMs - now;

    // Access-token expiry only requires refresh, never destructive sign-out.
    if (msUntilExpiry <= 0) {
      void refreshSessionForTimeout();
      return;
    }

    expiryTimeoutRef.current = setTimeout(() => {
      void refreshSessionForTimeout();
    }, msUntilExpiry);

    const warningDelayMs = msUntilExpiry - SESSION_WARNING_LEAD_MS;

    if (warningDelayMs > 0) {
      warningTimeoutRef.current = setTimeout(() => {
        Alert.alert(
          'Refresh session',
          'Your connection needs refreshing. You can keep using offline data if the network is unavailable.',
          [
            {
              text: 'Log out now',
              style: 'destructive',
              onPress: () => {
                setError('You signed out before session expiry.');
                void signOut();
              },
            },
            {
              text: 'Stay logged in',
              onPress: () => {
                void refreshSessionForTimeout();
              },
            },
          ],
          { cancelable: false }
        );
      }, warningDelayMs);
    }

    return clearSessionTimers;
  }, [clearSessionTimers, isMockUser, refreshSessionForTimeout, session, signOut]);

  const signInWithMagicLink = useCallback(async (email: string) => {
    try {
      setIsSigningIn(true);
      setError(null);
      await oauthHandler.markMagicLinkPending();

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectUrl,
          shouldCreateUser: true,
        },
      });

      if (error) {
        await oauthHandler.clearMagicLinkPending();
        return { error };
      }

      return { error: undefined };
    } catch (error) {
      const appErr = createError('auth', 'MAGIC_LINK_FAILED', error instanceof Error ? error.message : 'Failed to send magic link', {
        retryable: true,
        severity: 'error',
        details: error,
      });
      logError(appErr, { feature: 'auth', location: 'signInWithMagicLink' });
      setError(mapToUserMessage(appErr));
      return { error: { message: appErr.message, status: 500 } as AuthError };
    } finally {
      setIsSigningIn(false);
    }
  }, [oauthHandler]);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    try {
      setIsSigningIn(true);
      setError(null);
      console.log('[Auth] Attempting to sign in with email:', email);
      
      // Check if Supabase client is properly configured
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || Constants.expoConfig?.extra?.supabaseUrl;
      const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || Constants.expoConfig?.extra?.supabaseAnonKey;
      
      if (!supabaseUrl || !supabaseKey) {
        console.error('[Auth] Missing Supabase environment variables');
        const configErr = createError('auth', 'CONFIG_ERROR', 'Supabase configuration is missing. Please check your environment variables.', {
          retryable: false,
          severity: 'error',
        });
        setError(mapToUserMessage(configErr));
        return { error: { message: 'App configuration error. Please contact support.', status: 500 } as AuthError };
      }
      
      console.log('[Auth] Supabase URL:', supabaseUrl);
      console.log('[Auth] Supabase Key present:', !!supabaseKey);
      
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      
      console.log('[Auth] signInWithPassword response:', { 
        hasData: !!data, 
        hasError: !!error,
        errorMessage: error?.message,
        errorStatus: error?.status
      });
      
      if (error) {
        console.error('[Auth] Supabase auth error:', error);
        return { error };
      }

      console.log('[Auth] Sign in successful');
      if (data.session) {
        await updateAuthState(data.session, 'email_signin');
      }

      return { error: undefined };
    } catch (error) {
      console.error('[Auth] Unexpected error during sign in:', error);
      
      // Check if it's a network error
      if (error instanceof TypeError && error.message === 'Network request failed') {
        console.log('[Auth] Network error detected, running diagnostics...');
        
        // Run diagnostics to get more detailed error information
        const diagnostics = await runDiagnostics();
        console.log('[Auth] Diagnostics results:', diagnostics);
        
        let errorMessage = 'Network connection failed. Please check your internet connection and try again.';
        
        if (diagnostics.environment.issues.length > 0) {
          errorMessage = `Configuration error: ${diagnostics.environment.issues.join(', ')}. Please check your .env file.`;
        } else if (!diagnostics.network.isConnected) {
          errorMessage = diagnostics.network.error || errorMessage;
        }
        
        const networkErr = createError('auth', 'NETWORK_ERROR', 'Unable to connect to authentication server. Please check your internet connection.', {
          retryable: true,
          severity: 'error',
          details: { error, diagnostics },
        });
        logError(networkErr, { feature: 'auth', location: 'signInWithEmail' });
        setError(mapToUserMessage(networkErr));
        return { error: { message: errorMessage, status: 0 } as AuthError };
      }
      
      const appErr = createError('auth', 'EMAIL_SIGNIN_FAILED', error instanceof Error ? error.message : 'Failed to sign in', {
        retryable: true,
        severity: 'error',
        details: error,
      });
      logError(appErr, { feature: 'auth', location: 'signInWithEmail' });
      setError(mapToUserMessage(appErr));
      return { error: { message: appErr.message, status: 500 } as AuthError };
    } finally {
      setIsSigningIn(false);
    }
  }, [updateAuthState]);

  const signUpWithEmail = useCallback(async (email: string, password: string, userData?: { fullName?: string }) => {
    try {
      setIsSigningIn(true);
      setError(null);
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: userData?.fullName || '',
          },
        },
      });

      if (!error && data.session) {
        await updateAuthState(data.session, 'email_signup');
      }

      return { error: error || undefined };
    } catch (error) {
      const appErr = createError('auth', 'EMAIL_SIGNUP_FAILED', error instanceof Error ? error.message : 'Failed to sign up', {
        retryable: true,
        severity: 'error',
        details: error,
      });
      logError(appErr, { feature: 'auth', location: 'signUpWithEmail' });
      setError(mapToUserMessage(appErr));
      return { error: { message: appErr.message, status: 500 } as AuthError };
    } finally {
      setIsSigningIn(false);
    }
  }, [updateAuthState]);

  const updateProfile = useCallback(async (updates: { fullName?: string }) => {
    try {
      if (!user) {
        return { error: new Error('Not signed in') };
      }

      const { data, error } = await supabase.auth.updateUser({
        data: {
          full_name: updates.fullName ?? user.user_metadata?.full_name ?? '',
          name: updates.fullName ?? user.user_metadata?.name ?? '',
        },
      });

      if (error) {
        return { error };
      }

      let updatedUser = data?.user ?? user;
      let refreshedSession: Session | null = null;

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        refreshedSession = sessionData.session ?? null;
        if (refreshedSession?.user) {
          updatedUser = refreshedSession.user;
          previousUserIdRef.current = refreshedSession.user.id;
          setSession(refreshedSession);
          if (!isMockUser) {
            await sessionManager.storeSession(refreshedSession);
          }
        }
      } catch (storeError) {
        console.warn('[Auth] Failed to refresh stored session after profile update:', storeError);
      }

      if (updatedUser) {
        setUser(updatedUser);
        if (!refreshedSession) {
          setSession((prev) => (prev ? { ...prev, user: updatedUser } : prev));
        }
      }

      return { error: undefined };
    } catch (error) {
      console.error('[Auth] Error updating profile:', error);
      return { error: error as Error };
    }
  }, [user, isMockUser, sessionManager]);

  const resetPassword = useCallback(async (email: string) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: Linking.createURL('/reset-password'),
      });
      return { error: error || undefined };
    } catch (error) {
      const appErr = createError('auth', 'RESET_PASSWORD_FAILED', error instanceof Error ? error.message : 'Failed to reset password', {
        retryable: true,
        severity: 'error',
        details: error,
      });
      logError(appErr, { feature: 'auth', location: 'resetPassword' });
      setError(mapToUserMessage(appErr));
      return { error: { message: appErr.message, status: 500 } as AuthError };
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      session,
      isAuthStateCurrent,
      loading,
      isSigningIn,
      isMockUser,
      error,
      signInWithGoogle,
      signInWithApple,
      signInWithEmail,
      signInWithMagicLink,
      signUpWithEmail,
      resetPassword,
      updateProfile,
      signOut,
      deleteAccount,
      handleAuthCallback,
      clearError,
    }),
    [
      user,
      session,
      isAuthStateCurrent,
      loading,
      isSigningIn,
      isMockUser,
      error,
      signInWithGoogle,
      signInWithApple,
      signInWithEmail,
      signInWithMagicLink,
      signUpWithEmail,
      resetPassword,
      updateProfile,
      signOut,
      deleteAccount,
      handleAuthCallback,
      clearError,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
