import { OAuthHandler } from '@/lib/services/OAuthHandler';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SessionManager } from '../../lib/services/SessionManager';

export default function AuthCallback() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const oauthHandler = OAuthHandler.getInstance();
  const sessionManager = SessionManager.getInstance();

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        console.log('[AuthCallback] Processing auth callback with OAuthHandler...');

        // Build a URL to parse from Linking or window (web)
        const initialUrl = (await Linking.getInitialURL()) || (typeof window !== 'undefined' ? window.location.href : '');
        console.log('[AuthCallback] Initial URL:', initialUrl);

        if (!initialUrl) {
          console.error('[AuthCallback] No URL found for callback processing');
          router.replace('/sign-in?error=no_url');
          return;
        }

        // Use OAuthHandler to process the callback
        const session = await oauthHandler.handleCallback(initialUrl);

        if (session) {
          console.log('[AuthCallback] Successfully processed callback and created session');
          await sessionManager.storeSession(session);
          router.replace('/');
        } else {
          console.error('[AuthCallback] Failed to create session from callback');
          router.replace('/sign-in?error=callback_failed');
        }
      } catch (error) {
        console.error('[AuthCallback] Unexpected error in auth callback:', error);
        router.replace('/sign-in?error=unexpected');
      }
    };

    handleAuthCallback();
  }, [router, params.code, oauthHandler, sessionManager]);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" />
      <Text style={{ marginTop: 10 }}>Completing sign in...</Text>
    </View>
  );
}
