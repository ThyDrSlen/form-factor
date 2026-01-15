import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import type * as AuthContextModule from '@/contexts/AuthContext';
import type { Session, User } from '@supabase/supabase-js';

// Mock user and session data
const mockUser: User = {
  id: 'test-user-123',
  app_metadata: { provider: 'google' },
  user_metadata: {
    name: 'Test User',
    email: 'test@example.com',
  },
  email: 'test@example.com',
  created_at: new Date().toISOString(),
  aud: 'authenticated',
  role: 'authenticated',
} as User;

const mockSession: Session = {
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  expires_in: 3600,
  token_type: 'bearer',
  user: mockUser,
} as Session;

// Mock SessionManager
const mockSessionManager = {
  getInstance: jest.fn(),
  getStoredSession: jest.fn(),
  storeSession: jest.fn(),
  clearSession: jest.fn(),
  isSessionValid: jest.fn(),
};

jest.mock('@/lib/services/SessionManager', () => ({
  SessionManager: {
    getInstance: () => mockSessionManager,
  },
}));

// Mock OAuthHandler
const mockOAuthHandler = {
  getInstance: jest.fn(),
  initiateOAuth: jest.fn(),
  handleCallback: jest.fn(),
};

jest.mock('@/lib/services/OAuthHandler', () => ({
  OAuthHandler: {
    getInstance: () => mockOAuthHandler,
  },
}));

// Supabase mock is defined in tests/setup.ts and exported via global
const mockSupabaseAuth = (global as any).__mockSupabaseAuth as {
  getSession: jest.Mock;
  setSession: jest.Mock;
  signInWithPassword: jest.Mock;
  signUp: jest.Mock;
  signOut: jest.Mock;
  updateUser: jest.Mock;
  resetPasswordForEmail: jest.Mock;
  onAuthStateChange: jest.Mock;
};

const mockUnsubscribe = jest.fn();
let authStateChangeCallback: ((event: string, session: any) => void) | null = null;

// Mock localDB
const mockLocalDB = {
  clearAllData: jest.fn(),
};

jest.mock('@/lib/services/database/local-db', () => ({
  localDB: mockLocalDB,
}));

// Mock syncService
const mockSyncService = {
  cleanupRealtimeSync: jest.fn(),
};

jest.mock('@/lib/services/database/sync-service', () => ({
  syncService: mockSyncService,
}));

// Mock expo-linking
jest.mock('expo-linking', () => ({
  createURL: jest.fn((path: string) => `formfactor:///${path}`),
}));

// Mock network-utils
jest.mock('@/lib/network-utils', () => ({
  runDiagnostics: jest.fn().mockResolvedValue({ ok: true }),
}));

// Mock auth-utils
jest.mock('@/lib/auth-utils', () => ({
  signInWithApple: jest.fn(),
}));

// Mock notifications
jest.mock('@/lib/services/notifications', () => ({
  registerDevicePushToken: jest.fn().mockResolvedValue({ error: null }),
  unregisterDevicePushToken: jest.fn().mockResolvedValue({ error: null }),
}));

// Mock ErrorHandler
jest.mock('@/lib/services/ErrorHandler', () => ({
  createError: jest.fn((domain, code, message) => ({ domain, code, message })),
  mapToUserMessage: jest.fn((err) => err.message),
  logError: jest.fn(),
}));

type AuthModule = typeof AuthContextModule;
let AuthProvider: AuthModule['AuthProvider'];
let useAuth: AuthModule['useAuth'];

beforeAll(() => {
  const authModule = require('@/contexts/AuthContext') as AuthModule;
  AuthProvider = authModule.AuthProvider;
  useAuth = authModule.useAuth;
});

// Wrapper component for testing hooks
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

describe('AuthContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authStateChangeCallback = null;
    
    // Default mock implementations
    mockSessionManager.getStoredSession.mockResolvedValue(null);
    mockSessionManager.isSessionValid.mockReturnValue(false);
    mockSessionManager.storeSession.mockResolvedValue(undefined);
    mockSessionManager.clearSession.mockResolvedValue(undefined);
    
    mockSupabaseAuth.getSession.mockResolvedValue({ data: { session: null } });
    mockSupabaseAuth.setSession.mockResolvedValue({ error: null });
    mockSupabaseAuth.signOut.mockResolvedValue({ error: null });
    mockSupabaseAuth.onAuthStateChange.mockImplementation((callback: (event: string, session: any) => void) => {
      authStateChangeCallback = callback;
      return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
    });
    
    mockLocalDB.clearAllData.mockResolvedValue(undefined);
    mockSyncService.cleanupRealtimeSync.mockResolvedValue(undefined);
  });

  describe('useAuth hook', () => {
    it('should throw error when used outside AuthProvider', () => {
      // Suppress console.error for this test
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      expect(() => {
        renderHook(() => useAuth());
      }).toThrow('useAuth must be used within an AuthProvider');
      
      consoleSpy.mockRestore();
    });
  });

  describe('initialization', () => {
    it('should start with loading state', async () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      expect(result.current.loading).toBe(true);
      expect(result.current.user).toBeNull();
      expect(result.current.session).toBeNull();

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });

    it('should restore valid stored session', async () => {
      mockSessionManager.getStoredSession.mockResolvedValue(mockSession);
      mockSessionManager.isSessionValid.mockReturnValue(true);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.user).toEqual(mockUser);
      expect(result.current.session).toEqual(mockSession);
      expect(mockSupabaseAuth.setSession).toHaveBeenCalledWith({
        access_token: mockSession.access_token,
        refresh_token: mockSession.refresh_token,
      });
    });

    it('should fall back to Supabase session if no stored session', async () => {
      mockSessionManager.getStoredSession.mockResolvedValue(null);
      mockSupabaseAuth.getSession.mockResolvedValue({ 
        data: { session: mockSession } 
      });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.user).toEqual(mockUser);
      expect(result.current.session).toEqual(mockSession);
    });

    it('should clear stored session if setSession fails', async () => {
      mockSessionManager.getStoredSession.mockResolvedValue(mockSession);
      mockSessionManager.isSessionValid.mockReturnValue(true);
      mockSupabaseAuth.setSession.mockResolvedValue({ 
        error: { message: 'Invalid token' } 
      });
      mockSupabaseAuth.getSession.mockResolvedValue({ data: { session: null } });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockSessionManager.clearSession).toHaveBeenCalled();
    });

    it('should set error state on initialization failure', async () => {
      mockSessionManager.getStoredSession.mockRejectedValue(new Error('Storage error'));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Failed to initialize authentication');
    });
  });

  describe('signInWithEmail', () => {
    it('should sign in successfully with email and password', async () => {
      mockSupabaseAuth.signInWithPassword.mockResolvedValue({
        data: { user: mockUser, session: mockSession },
        error: null,
      });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      let signInResult: { error?: any };
      await act(async () => {
        signInResult = await result.current.signInWithEmail('test@example.com', 'password123');
      });

      expect(signInResult!.error).toBeUndefined();
      expect(mockSupabaseAuth.signInWithPassword).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      });
    });

    it('should return error on failed sign in', async () => {
      const authError = { message: 'Invalid credentials', status: 401 };
      mockSupabaseAuth.signInWithPassword.mockResolvedValue({
        data: { user: null, session: null },
        error: authError,
      });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      let signInResult: { error?: any };
      await act(async () => {
        signInResult = await result.current.signInWithEmail('test@example.com', 'wrong');
      });

      expect(signInResult!.error).toEqual(authError);
    });

    it('should set isSigningIn during sign in process', async () => {
      let resolveSignIn: (value: any) => void;
      const signInPromise = new Promise((resolve) => {
        resolveSignIn = resolve;
      });
      mockSupabaseAuth.signInWithPassword.mockReturnValue(signInPromise);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.isSigningIn).toBe(false);

      act(() => {
        result.current.signInWithEmail('test@example.com', 'password123');
      });

      await waitFor(() => {
        expect(result.current.isSigningIn).toBe(true);
      });

      await act(async () => {
        resolveSignIn!({ data: { user: mockUser, session: mockSession }, error: null });
      });

      await waitFor(() => {
        expect(result.current.isSigningIn).toBe(false);
      });
    });
  });

  describe('signUpWithEmail', () => {
    it('should sign up successfully', async () => {
      mockSupabaseAuth.signUp.mockResolvedValue({
        data: { user: mockUser, session: mockSession },
        error: null,
      });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      let signUpResult: { error?: any };
      await act(async () => {
        signUpResult = await result.current.signUpWithEmail('new@example.com', 'password123', {
          fullName: 'New User',
        });
      });

      expect(signUpResult!.error).toBeUndefined();
      expect(mockSupabaseAuth.signUp).toHaveBeenCalledWith({
        email: 'new@example.com',
        password: 'password123',
        options: {
          data: {
            full_name: 'New User',
          },
        },
      });
    });

    it('should return error on failed sign up', async () => {
      const authError = { message: 'Email already exists', status: 400 };
      mockSupabaseAuth.signUp.mockResolvedValue({
        data: { user: null, session: null },
        error: authError,
      });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      let signUpResult: { error?: any };
      await act(async () => {
        signUpResult = await result.current.signUpWithEmail('existing@example.com', 'password123');
      });

      expect(signUpResult!.error).toEqual(authError);
    });
  });

  describe('signOut', () => {
    it('should sign out and clear state', async () => {
      mockSessionManager.getStoredSession.mockResolvedValue(mockSession);
      mockSessionManager.isSessionValid.mockReturnValue(true);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.user).toEqual(mockUser);
      });

      await act(async () => {
        await result.current.signOut();
      });

      expect(result.current.user).toBeNull();
      expect(result.current.session).toBeNull();
      expect(mockSessionManager.clearSession).toHaveBeenCalled();
      expect(mockSupabaseAuth.signOut).toHaveBeenCalled();
    });

    it('should handle sign out timeout gracefully', async () => {
      mockSessionManager.getStoredSession.mockResolvedValue(mockSession);
      mockSessionManager.isSessionValid.mockReturnValue(true);
      
      // Make signOut hang
      mockSupabaseAuth.signOut.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.user).toEqual(mockUser);
      });

      // Should complete despite timeout (optimistic clear)
      await act(async () => {
        await result.current.signOut();
      });

      // State should still be cleared optimistically
      expect(result.current.user).toBeNull();
      expect(result.current.session).toBeNull();
    });
  });

  describe('signInWithGoogle', () => {
    it('should initiate Google OAuth successfully', async () => {
      mockOAuthHandler.initiateOAuth.mockResolvedValue({ success: true, session: mockSession });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.signInWithGoogle();
      });

      expect(mockOAuthHandler.initiateOAuth).toHaveBeenCalledWith('google');
    });

    it('should handle OAuth failure', async () => {
      mockOAuthHandler.initiateOAuth.mockResolvedValue({ success: false, error: 'OAuth failed' });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.signInWithGoogle();
      });

      expect(result.current.error).toBeDefined();
    });
  });

  describe('handleAuthCallback', () => {
    it('should handle OAuth callback successfully', async () => {
      mockOAuthHandler.handleCallback.mockResolvedValue({ ok: true });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.handleAuthCallback('formfactor:///callback?code=test');
      });

      expect(mockOAuthHandler.handleCallback).toHaveBeenCalledWith('formfactor:///callback?code=test');
    });

    it('should set error when callback fails', async () => {
      const callbackError = { domain: 'oauth', code: 'CALLBACK_FAILED', message: 'Callback failed' };
      mockOAuthHandler.handleCallback.mockResolvedValue({ ok: false, error: callbackError });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.handleAuthCallback('formfactor:///callback?error=test');
      });

      expect(result.current.error).toBeDefined();
    });
  });

  describe('updateProfile', () => {
    it('should update user profile', async () => {
      mockSessionManager.getStoredSession.mockResolvedValue(mockSession);
      mockSessionManager.isSessionValid.mockReturnValue(true);
      
      const updatedUser = { ...mockUser, user_metadata: { ...mockUser.user_metadata, full_name: 'Updated Name' } };
      mockSupabaseAuth.updateUser.mockResolvedValue({
        data: { user: updatedUser },
        error: null,
      });
      mockSupabaseAuth.getSession.mockResolvedValue({
        data: { session: { ...mockSession, user: updatedUser } },
      });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.user).toEqual(mockUser);
      });

      let updateResult: { error?: any };
      await act(async () => {
        updateResult = await result.current.updateProfile({ fullName: 'Updated Name' });
      });

      expect(updateResult!.error).toBeUndefined();
      expect(mockSupabaseAuth.updateUser).toHaveBeenCalledWith({
        data: expect.objectContaining({
          full_name: 'Updated Name',
        }),
      });
    });

    it('should return error when not signed in', async () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      let updateResult: { error?: any };
      await act(async () => {
        updateResult = await result.current.updateProfile({ fullName: 'Test' });
      });

      expect(updateResult!.error).toEqual(new Error('Not signed in'));
    });
  });

  describe('resetPassword', () => {
    it('should send password reset email', async () => {
      mockSupabaseAuth.resetPasswordForEmail.mockResolvedValue({ error: null });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      let resetResult: { error?: any };
      await act(async () => {
        resetResult = await result.current.resetPassword('test@example.com');
      });

      expect(resetResult!.error).toBeUndefined();
      expect(mockSupabaseAuth.resetPasswordForEmail).toHaveBeenCalledWith(
        'test@example.com',
        expect.objectContaining({
          redirectTo: expect.stringContaining('reset-password'),
        })
      );
    });
  });

  describe('clearError', () => {
    it('should clear error state', async () => {
      // First cause an error
      mockSessionManager.getStoredSession.mockRejectedValue(new Error('Test error'));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.error).toBe('Failed to initialize authentication');
      });

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe('auth state change listener', () => {
    it('should update state on SIGNED_IN event', async () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Simulate auth state change
      await act(async () => {
        if (authStateChangeCallback) {
          authStateChangeCallback('SIGNED_IN', mockSession);
        }
      });

      await waitFor(() => {
        expect(result.current.user).toEqual(mockUser);
        expect(result.current.session).toEqual(mockSession);
      });
    });

    it('should clear state on SIGNED_OUT event', async () => {
      mockSessionManager.getStoredSession.mockResolvedValue(mockSession);
      mockSessionManager.isSessionValid.mockReturnValue(true);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.user).toEqual(mockUser);
      });

      // Simulate sign out event
      await act(async () => {
        if (authStateChangeCallback) {
          authStateChangeCallback('SIGNED_OUT', null);
        }
      });

      await waitFor(() => {
        expect(result.current.user).toBeNull();
        expect(result.current.session).toBeNull();
      });
    });

    it('should cleanup subscriptions on unmount', async () => {
      const { unmount } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(mockSupabaseAuth.onAuthStateChange).toHaveBeenCalled();
      });

      unmount();

      expect(mockUnsubscribe).toHaveBeenCalled();
    });
  });

  describe('user change cleanup', () => {
    it('should clear local data when user changes', async () => {
      mockSessionManager.getStoredSession.mockResolvedValue(mockSession);
      mockSessionManager.isSessionValid.mockReturnValue(true);

      const { result } = renderHook(() => useAuth(), { wrapper });

      // Wait for initial auth to complete and user to be set
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.user).toEqual(mockUser);
      });

      // Ensure the onAuthStateChange callback was registered
      expect(authStateChangeCallback).not.toBeNull();

      // Simulate user change via auth state change
      const newUser = { ...mockUser, id: 'different-user-456' };
      const newSession = { ...mockSession, user: newUser };

      await act(async () => {
        authStateChangeCallback!('SIGNED_IN', newSession);
      });

      await waitFor(() => {
        expect(mockLocalDB.clearAllData).toHaveBeenCalled();
      });
    });
  });
});
