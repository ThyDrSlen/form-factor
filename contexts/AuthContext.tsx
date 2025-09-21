import { OAuthHandler } from '@/lib/services/OAuthHandler';
import { createError, mapToUserMessage, logError } from '@/lib/services/ErrorHandler';
import { AuthError, Session, User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { SessionManager } from '../lib/services/SessionManager';
import { supabase } from '../lib/supabase';

// In Expo Router, group folders like (auth) are omitted from the URL path.
// The file app/(auth)/callback.tsx resolves to '/callback', not '/auth/callback'.
const redirectUrl = Linking.createURL('/callback');

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

type AuthContextType = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isSigningIn: boolean;
  isMockUser: boolean;
  error: string | null;
  signInWithGoogle: () => Promise<{ error?: AuthError }>;
  signInWithApple: () => Promise<{ error?: AuthError }>;
  signInWithEmail: (email: string, password: string) => Promise<{ error?: AuthError }>;
  signUpWithEmail: (email: string, password: string, userData?: { fullName?: string }) => Promise<{ error?: AuthError }>;
  resetPassword: (email: string) => Promise<{ error?: AuthError }>;
  signOut: () => Promise<{ error?: Error }>;
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

  const sessionManager = SessionManager.getInstance();
  const oauthHandler = OAuthHandler.getInstance();

  // Clear error helper
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Helper to update auth state
  const updateAuthState = useCallback(async (newSession: Session | null, source: string) => {
    try {
      console.log(`[Auth] Updating auth state from ${source}:`, {
        hasSession: !!newSession,
        userId: newSession?.user?.id
      });

      setSession(newSession);
      setUser(newSession ? newSession.user : null);

      // Store or clear session based on state
      if (newSession && !isMockUser) {
        await sessionManager.storeSession(newSession);
      } else if (!newSession) {
        await sessionManager.clearSession();
      }

      setLoading(false);
    } catch (error) {
      console.error('[Auth] Error updating auth state:', error);
      setLoading(false);
    }
  }, [sessionManager, isMockUser]);

  // Initialize auth state
  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      try {
        console.log('[Auth] Initializing authentication...');

        // First, try to get stored session
        const storedSession = await sessionManager.getStoredSession();

        if (storedSession && sessionManager.isSessionValid(storedSession)) {
          console.log('[Auth] Found valid stored session, setting it in Supabase');

          // Set the session in Supabase client
          const { error } = await supabase.auth.setSession({
            access_token: storedSession.access_token,
            refresh_token: storedSession.refresh_token,
          });

          if (error) {
            console.error('[Auth] Error setting stored session:', error);
            await sessionManager.clearSession();
          } else if (mounted) {
            await updateAuthState(storedSession, 'stored_session');
            return; // Exit early if we successfully restored session
          }
        }

        // If no valid stored session, check Supabase's current session
        const { data: { session: currentSession } } = await supabase.auth.getSession();

        if (mounted) {
          await updateAuthState(currentSession, 'supabase_session');
        }
      } catch (error) {
        console.error('[Auth] Error initializing auth:', error);
        if (mounted) {
          setLoading(false);
          setError('Failed to initialize authentication');
        }
      }
    };

    initializeAuth();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;

      console.log(`[Auth] Auth state changed:`, { event, hasSession: !!session });

      // Don't override mock user state
      if (isMockUser && event !== 'SIGNED_OUT') {
        return;
      }

      await updateAuthState(session, `auth_event_${event}`);
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, [updateAuthState, sessionManager, isMockUser]);

  const handleAuthCallback = useCallback(async (url: string): Promise<void> => {
    try {
      console.log('[Auth] Handling auth callback with OAuthHandler');
      
      const session = await oauthHandler.handleCallback(url);
      
      if (session) {
        console.log('[Auth] Callback handled successfully, session created');
        // Session will be handled by the auth state change listener
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
  }, [oauthHandler]);



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
        // Session will be handled by the auth state change listener
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
  }, [signInWithMock, oauthHandler]);

  /**
   * Sign in with Apple OAuth provider
   * Note: Apple Sign-In is only available on iOS 13+
   */
  const signInWithApple = useCallback(async () => {
    try {
      setIsSigningIn(true);
      setError(null);

      console.log('[Auth] Starting Apple OAuth with OAuthHandler');
      const result = await oauthHandler.initiateOAuth('apple');

      if (result.success && result.session) {
        console.log('[Auth] Apple OAuth successful');
        // Session will be handled by the auth state change listener
        return {};
      } else {
        const appErr = createError('oauth', 'OAUTH_START_FAILED', result.error || 'Apple sign-in failed', {
          retryable: true,
          severity: 'warning',
          details: result,
        });
        logError(appErr, { feature: 'auth', location: 'signInWithApple' });
        setError(mapToUserMessage(appErr));
        return { 
          error: { 
            message: result?.error || 'Apple sign-in failed', 
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
  }, [oauthHandler]);

  const signOut = useCallback(async () => {
    try {
      console.log('[Auth] Signing out user');

      if (isMockUser) {
        console.log('[Auth] Signing out mock user');
        setUser(null);
        setSession(null);
        setIsMockUser(false);
        await sessionManager.clearSession();
        return {};
      }

      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('[Auth] Error signing out:', error);
        return { error };
      }

      // Clear stored session
      await sessionManager.clearSession();

      // Update state
      setUser(null);
      setSession(null);
      setError(null);

      return {};
    } catch (error) {
      console.error('[Auth] Error in signOut:', error);
      return { error: error as Error };
    }
  }, [isMockUser, sessionManager]);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    try {
      setIsSigningIn(true);
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      console.log('signInWithPassword →', { data, error });
      return { error: error || undefined };
    } catch (error) {
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
  }, []);

  const signUpWithEmail = useCallback(async (email: string, password: string, userData?: { fullName?: string }) => {
    try {
      setIsSigningIn(true);
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: userData?.fullName || '',
          },
        },
      });
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
  }, []);

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

  const value = {
    user,
    session,
    loading,
    isSigningIn,
    isMockUser,
    error,
    signInWithGoogle,
    signInWithApple,
    signInWithEmail,
    signUpWithEmail,
    resetPassword,
    signOut,
    handleAuthCallback,
    clearError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
