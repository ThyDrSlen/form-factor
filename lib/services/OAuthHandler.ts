import { Session } from '@supabase/supabase-js';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { errorWithTs, logWithTs, warnWithTs } from '@/lib/logger';
import { supabase } from '../supabase';

 // Ensure the auth session is correctly completed when returning to the app (iOS 11+)
 // This avoids lingering authentication sessions after the redirect back to the app.
 WebBrowser.maybeCompleteAuthSession();

interface AuthResult {
  success: boolean;
  session?: Session;
  error?: string;
}

interface ParsedTokens {
  accessToken: string;
  refreshToken: string;
}

export const OAUTH_PENDING_STATE_KEY = 'ff.auth.oauth.pendingState';
export const MAGIC_LINK_PENDING_KEY = 'ff.auth.magicLink.pending';
const AUTH_CALLBACK_INTENT_TTL_MS = 10 * 60 * 1000;

type PendingAuthIntent = {
  value: string;
  createdAt: number;
};

export class OAuthHandler {
  private static instance: OAuthHandler;
  private redirectUrl: string;
  private pendingOAuthState: string | null = null;

  constructor() {
    // In Expo Router, group folders like (auth) are omitted from the URL path
    this.redirectUrl = Linking.createURL('callback');
    logWithTs('[OAuthHandler] Configured redirect URL:', this.redirectUrl);
  }

  static getInstance(): OAuthHandler {
    if (!OAuthHandler.instance) {
      OAuthHandler.instance = new OAuthHandler();
    }
    return OAuthHandler.instance;
  }

  /**
   * Initiate OAuth flow with the specified provider
   */
  async initiateOAuth(provider: 'google' | 'apple'): Promise<AuthResult> {
    try {
      logWithTs(`[OAuthHandler] Starting ${provider} OAuth flow`);

      // Guard against concurrent OAuth flows — the previous flow's CSRF state
      // would be overwritten and its callback would fail validation.
      if (this.pendingOAuthState !== null) {
        warnWithTs(
          '[OAuthHandler] New OAuth flow started while one was already in progress — ' +
          'clearing previous pending state to avoid CSRF race'
        );
        // A4: proactively dismiss any in-flight WebBrowser auth session so
        // the previous browser sheet is torn down before we start a new
        // flow. Safe to call when no session is active (expo-web-browser
        // treats it as a no-op). Catching is defensive in case a future
        // release throws for closed sessions.
        try {
          WebBrowser.dismissAuthSession();
        } catch {
          // non-fatal
        }
        this.pendingOAuthState = null;
        await this.clearPendingOAuthState();
      }

      this.pendingOAuthState = Crypto.randomUUID();
      await this.persistPendingOAuthState(this.pendingOAuthState);

      // Supabase owns the provider's OAuth state. Carry our app nonce in
      // redirectTo instead: Supabase preserves its query when returning tokens
      // or a PKCE code. Sending queryParams.state does not round-trip this nonce.
      const callbackUrl = new URL(this.redirectUrl);
      callbackUrl.searchParams.set('state', this.pendingOAuthState);
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: callbackUrl.toString(),
          skipBrowserRedirect: true,
        },
      });

      if (error) {
        this.pendingOAuthState = null;
        await this.clearPendingOAuthState();
        errorWithTs(`[OAuthHandler] Error starting ${provider} OAuth:`, error);
        return {
          success: false,
          error: `Failed to start ${provider} sign-in: ${error.message}`,
        };
      }

      if (!data.url) {
        this.pendingOAuthState = null;
        await this.clearPendingOAuthState();
        errorWithTs(`[OAuthHandler] No OAuth URL returned from Supabase`);
        return {
          success: false,
          error: `No authentication URL received from ${provider}`,
        };
      }

      logWithTs(`[OAuthHandler] Opening OAuth URL for ${provider}`);

      // Open the OAuth URL in browser
      const result = await WebBrowser.openAuthSessionAsync(
        data.url,
        this.redirectUrl
      );

      logWithTs(`[OAuthHandler] OAuth browser result:`, result.type);

      if (result.type === 'success') {
        // Parse the callback URL to extract tokens or code
        const session = await this.handleCallback(result.url);

        if (session) {
          return {
            success: true,
            session,
          };
        } else {
          return {
            success: false,
            error: 'Failed to extract session from OAuth callback',
          };
        }
      }

      if (result.type === 'cancel') {
        this.pendingOAuthState = null;
        await this.clearPendingOAuthState();
        logWithTs(`[OAuthHandler] User cancelled ${provider} OAuth`);
        return {
          success: false,
          error: 'Sign-in was cancelled',
        };
      }

      if (result.type === 'dismiss') {
        this.pendingOAuthState = null;
        await this.clearPendingOAuthState();
        logWithTs(`[OAuthHandler] ${provider} OAuth was dismissed`);
        return {
          success: false,
          error: 'Sign-in was dismissed',
        };
      }

      this.pendingOAuthState = null;
      await this.clearPendingOAuthState();
      return {
        success: false,
        error: `Unexpected OAuth result: ${result.type}`,
      };
    } catch (error) {
      this.pendingOAuthState = null;
      await this.clearPendingOAuthState();
      errorWithTs(`[OAuthHandler] Unexpected error in ${provider} OAuth:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'An unexpected error occurred',
      };
    }
  }

  /**
   * Handle OAuth callback URL and extract session
   */
  async handleCallback(url: string): Promise<Session | null> {
    try {
      logWithTs('[OAuthHandler] Processing callback URL:', url);

      const callbackState = this.parseStateFromUrl(url);
      const pendingOAuthState = this.pendingOAuthState ?? await this.loadPendingOAuthState();
      const hasPendingMagicLink = await this.hasPendingMagicLinkIntent();

      if (callbackState || pendingOAuthState) {
        if (!callbackState || !pendingOAuthState || callbackState !== pendingOAuthState) {
          errorWithTs('[OAuthHandler] OAuth state validation failed', {
            hasPendingState: !!pendingOAuthState,
            hasCallbackState: !!callbackState,
            callbackStateMatches: callbackState === pendingOAuthState,
          });
          return null;
        }
      } else if (!hasPendingMagicLink) {
        errorWithTs('[OAuthHandler] OAuth state validation failed', {
          hasPendingState: false,
          hasCallbackState: !!callbackState,
          hasPendingMagicLink,
        });
        return null;
      }

      // Parse tokens from the URL
      const tokens = this.parseTokensFromUrl(url);
      
      if (tokens) {
        // Validate token format before attempting session creation
        if (!this.validateTokens(tokens)) {
          errorWithTs('[OAuthHandler] Token validation failed — tokens appear malformed');
          return null;
        }

        logWithTs('[OAuthHandler] Tokens validated, setting session');

        // Set session using the extracted tokens
        const { data, error } = await supabase.auth.setSession({
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
        });

        if (error) {
          errorWithTs('[OAuthHandler] Error setting session from tokens:', error);
          return null;
        }

        if (data.session) {
          logWithTs('[OAuthHandler] Successfully created session from tokens');
          return data.session;
        }
      }

      // Check for authorization code (PKCE flow)
      const { queryParams } = Linking.parse(url);
      const parsedCode = queryParams?.code;
      const code = typeof parsedCode === 'string' ? parsedCode : this.parseStringParamFromUrl(url, 'code');

      if (code) {
        logWithTs('[OAuthHandler] Found authorization code, exchanging for session');
        
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        
        if (error) {
          errorWithTs('[OAuthHandler] Error exchanging code for session:', error);
          return null;
        }

        if (data.session) {
          logWithTs('[OAuthHandler] Successfully exchanged code for session');
          return data.session;
        }
      }

      logWithTs('[OAuthHandler] No tokens or code found in callback URL');
      return null;
    } catch (error) {
      errorWithTs('[OAuthHandler] Error handling callback:', error);
      return null;
    } finally {
      this.pendingOAuthState = null;
      await Promise.all([
        this.clearPendingOAuthState(),
        this.clearPendingMagicLinkIntent(),
      ]);
    }
  }

  async markMagicLinkPending(): Promise<void> {
    await this.writeIntent(MAGIC_LINK_PENDING_KEY, 'pending');
  }

  async clearMagicLinkPending(): Promise<void> {
    await this.clearPendingMagicLinkIntent();
  }

  private async persistPendingOAuthState(state: string): Promise<void> {
    await this.writeIntent(OAUTH_PENDING_STATE_KEY, state);
  }

  private async loadPendingOAuthState(): Promise<string | null> {
    return this.readFreshIntent(OAUTH_PENDING_STATE_KEY);
  }

  private async clearPendingOAuthState(): Promise<void> {
    await AsyncStorage.removeItem(OAUTH_PENDING_STATE_KEY);
  }

  private async hasPendingMagicLinkIntent(): Promise<boolean> {
    return (await this.readFreshIntent(MAGIC_LINK_PENDING_KEY)) !== null;
  }

  private async clearPendingMagicLinkIntent(): Promise<void> {
    await AsyncStorage.removeItem(MAGIC_LINK_PENDING_KEY);
  }

  private async writeIntent(key: string, value: string): Promise<void> {
    const payload: PendingAuthIntent = {
      value,
      createdAt: Date.now(),
    };
    await AsyncStorage.setItem(key, JSON.stringify(payload));
  }

  private async readFreshIntent(key: string): Promise<string | null> {
    try {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<PendingAuthIntent>;
      if (typeof parsed.value !== 'string' || typeof parsed.createdAt !== 'number') {
        await AsyncStorage.removeItem(key);
        return null;
      }
      if (Date.now() - parsed.createdAt > AUTH_CALLBACK_INTENT_TTL_MS) {
        await AsyncStorage.removeItem(key);
        return null;
      }
      return parsed.value;
    } catch (error) {
      warnWithTs('[OAuthHandler] Failed to read pending auth intent', error);
      await AsyncStorage.removeItem(key);
      return null;
    }
  }

  private parseStateFromUrl(url: string): string | null {
    return this.parseStringParamFromUrl(url, 'state');
  }

  private parseStringParamFromUrl(url: string, name: string): string | null {
    try {
      const hashMatch = url.match(/#(.+)/);
      const queryMatch = url.match(/\?(.+?)(?:#|$)/);

      if (hashMatch) {
        const hashParams = new URLSearchParams(hashMatch[1]);
        const hashValue = hashParams.get(name);
        if (hashValue) return hashValue;
      }

      if (queryMatch) {
        const queryParams = new URLSearchParams(queryMatch[1]);
        return queryParams.get(name);
      }

      return null;
    } catch (error) {
      errorWithTs(`[OAuthHandler] Error parsing ${name} from URL:`, error);
      return null;
    }
  }

  /**
   * Parse access and refresh tokens from OAuth callback URL
   */
  parseTokensFromUrl(url: string): ParsedTokens | null {
    try {
      logWithTs('[OAuthHandler] Parsing tokens from URL');

      // Handle both hash fragments and query parameters
      const hashMatch = url.match(/#(.+)/);
      const queryMatch = url.match(/\?(.+?)(?:#|$)/);
      
      // Try hash fragment first (common for implicit flow)
      let searchParams: URLSearchParams;
      
      if (hashMatch) {
        logWithTs('[OAuthHandler] Found hash fragment in URL');
        searchParams = new URLSearchParams(hashMatch[1]);
      } else if (queryMatch) {
        logWithTs('[OAuthHandler] Found query parameters in URL');
        searchParams = new URLSearchParams(queryMatch[1]);
      } else {
        logWithTs('[OAuthHandler] No hash or query parameters found');
        return null;
      }

      // Extract tokens with multiple possible parameter names
      const accessToken = 
        searchParams.get('access_token') || 
        searchParams.get('accessToken') ||
        searchParams.get('token');

      const refreshToken = 
        searchParams.get('refresh_token') || 
        searchParams.get('refreshToken');

      logWithTs('[OAuthHandler] Token extraction result:', {
        hasAccessToken: !!accessToken,
        hasRefreshToken: !!refreshToken,
        accessTokenLength: accessToken?.length || 0,
        refreshTokenLength: refreshToken?.length || 0,
      });

      if (accessToken && refreshToken) {
        return {
          accessToken,
          refreshToken,
        };
      }

      logWithTs('[OAuthHandler] Missing required tokens');
      return null;
    } catch (error) {
      errorWithTs('[OAuthHandler] Error parsing tokens from URL:', error);
      return null;
    }
  }

  /**
   * Validate that tokens have the expected format
   */
  private validateTokens(tokens: ParsedTokens): boolean {
    // Basic validation - tokens should be non-empty strings
    if (!tokens.accessToken || !tokens.refreshToken) {
      return false;
    }

    // Access tokens are typically JWTs and should be longer
    if (tokens.accessToken.length < 50) {
      warnWithTs('[OAuthHandler] Access token seems too short');
      return false;
    }

    // Refresh tokens are opaque: Supabase also issues 12-character tokens.
    // Their authenticity is checked by Supabase, not an arbitrary local length.

    return true;
  }

  /**
   * Get the configured redirect URL
   */
  getRedirectUrl(): string {
    return this.redirectUrl;
  }
}
