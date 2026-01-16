import { OAuthHandler } from '@/lib/services/OAuthHandler';
import { errorWithTs, logWithTs } from '@/lib/logger';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SessionManager } from '../../lib/services/SessionManager';

export default function AuthCallback() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const oauthHandler = OAuthHandler.getInstance();
  const sessionManager = SessionManager.getInstance();

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        logWithTs('[AuthCallback] Processing auth callback with OAuthHandler...');

        // Build a URL to parse from Linking or window (web)
        const initialUrl = (await Linking.getInitialURL()) || (typeof window !== 'undefined' ? window.location.href : '');
        logWithTs('[AuthCallback] Initial URL:', initialUrl);

        if (!initialUrl) {
          errorWithTs('[AuthCallback] No URL found for callback processing');
          router.replace('/sign-in?error=no_url');
          return;
        }

        // Use OAuthHandler to process the callback
        const session = await oauthHandler.handleCallback(initialUrl);

        if (session) {
          logWithTs('[AuthCallback] Successfully processed callback and created session');
          await sessionManager.storeSession(session);
          router.replace('/');
        } else {
          errorWithTs('[AuthCallback] Failed to create session from callback');
          router.replace('/sign-in?error=callback_failed');
        }
      } catch (error) {
        errorWithTs('[AuthCallback] Unexpected error in auth callback:', error);
        router.replace('/sign-in?error=unexpected');
      }
    };

    handleAuthCallback();
  }, [router, params.code, oauthHandler, sessionManager]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" />
      <Text style={styles.message}>Completing sign in...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  message: {
    marginTop: 10,
  },
});
