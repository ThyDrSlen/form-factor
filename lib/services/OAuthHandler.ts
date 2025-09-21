import { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../supabase';

interface AuthResult {
  success: boolean;
  session?: Session;
  error?: string;
}

interface ParsedTokens {
  accessToken: string;
  refreshToken: string;
}

export class OAuthHandler {
  private static instance: OAuthHandler;
  private redirectUrl: string;

  constructor() {
    // In Expo Router, group folders like (auth) are omitted from the URL path
    this.redirectUrl = Linking.createURL('/callback');
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
      console.log(`[OAuthHandler] Starting ${provider} OAuth flow`);

      // Start the OAuth flow with Supabase
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: this.redirectUrl,
          skipBrowserRedirect: true,
        },
      });

      if (error) {
        console.error(`[OAuthHandler] Error starting ${provider} OAuth:`, error);
        return {
          success: false,
          error: `Failed to start ${provider} sign-in: ${error.message}`,
        };
      }

      if (!data.url) {
        console.error(`[OAuthHandler] No OAuth URL returned from Supabase`);
        return {
          success: false,
          error: `No authentication URL received from ${provider}`,
        };
      }

      console.log(`[OAuthHandler] Opening OAuth URL for ${provider}`);

      // Open the OAuth URL in browser
      const result = await WebBrowser.openAuthSessionAsync(
        data.url,
        this.redirectUrl
      );

      console.log(`[OAuthHandler] OAuth browser result:`, result.type);

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
        console.log(`[OAuthHandler] User cancelled ${provider} OAuth`);
        return {
          success: false,
          error: 'Sign-in was cancelled',
        };
      }

      if (result.type === 'dismiss') {
        console.log(`[OAuthHandler] ${provider} OAuth was dismissed`);
        return {
          success: false,
          error: 'Sign-in was dismissed',
        };
      }

      return {
        success: false,
        error: `Unexpected OAuth result: ${result.type}`,
      };
    } catch (error) {
      console.error(`[OAuthHandler] Unexpected error in ${provider} OAuth:`, error);
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
      console.log('[OAuthHandler] Processing callback URL:', url);

      // Parse tokens from the URL
      const tokens = this.parseTokensFromUrl(url);
      
      if (tokens) {
        console.log('[OAuthHandler] Found tokens in URL, setting session');
        
        // Set session using the extracted tokens
        const { data, error } = await supabase.auth.setSession({
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
        });

        if (error) {
          console.error('[OAuthHandler] Error setting session from tokens:', error);
          return null;
        }

        if (data.session) {
          console.log('[OAuthHandler] Successfully created session from tokens');
          return data.session;
        }
      }

      // Check for authorization code (PKCE flow)
      const { queryParams } = Linking.parse(url);
      const code = queryParams?.code as string;

      if (code) {
        console.log('[OAuthHandler] Found authorization code, exchanging for session');
        
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        
        if (error) {
          console.error('[OAuthHandler] Error exchanging code for session:', error);
          return null;
        }

        if (data.session) {
          console.log('[OAuthHandler] Successfully exchanged code for session');
          return data.session;
        }
      }

      console.log('[OAuthHandler] No tokens or code found in callback URL');
      return null;
    } catch (error) {
      console.error('[OAuthHandler] Error handling callback:', error);
      return null;
    }
  }

  /**
   * Parse access and refresh tokens from OAuth callback URL
   */
  parseTokensFromUrl(url: string): ParsedTokens | null {
    try {
      console.log('[OAuthHandler] Parsing tokens from URL');

      // Handle both hash fragments and query parameters
      const hashMatch = url.match(/#(.+)/);
      const queryMatch = url.match(/\?(.+?)(?:#|$)/);
      
      // Try hash fragment first (common for implicit flow)
      let searchParams: URLSearchParams;
      
      if (hashMatch) {
        console.log('[OAuthHandler] Found hash fragment in URL');
        searchParams = new URLSearchParams(hashMatch[1]);
      } else if (queryMatch) {
        console.log('[OAuthHandler] Found query parameters in URL');
        searchParams = new URLSearchParams(queryMatch[1]);
      } else {
        console.log('[OAuthHandler] No hash or query parameters found');
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

      console.log('[OAuthHandler] Token extraction result:', {
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

      console.log('[OAuthHandler] Missing required tokens');
      return null;
    } catch (error) {
      console.error('[OAuthHandler] Error parsing tokens from URL:', error);
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
      console.warn('[OAuthHandler] Access token seems too short');
      return false;
    }

    // Refresh tokens should also be substantial
    if (tokens.refreshToken.length < 20) {
      console.warn('[OAuthHandler] Refresh token seems too short');
      return false;
    }

    return true;
  }

  /**
   * Get the configured redirect URL
   */
  getRedirectUrl(): string {
    return this.redirectUrl;
  }
}