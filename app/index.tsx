import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { logWithTs } from '@/lib/logger';

export default function RootRedirect() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    if (Platform.OS === 'web' && !user) {
      logWithTs('[RootRedirect] Web visitor, redirecting to landing');
      router.replace('/landing');
      return;
    }

    if (user) {
      // User is signed in, redirect to tabs
      logWithTs('[RootRedirect] User signed in, redirecting to tabs');
      router.replace('/(tabs)');
    } else {
      // User is not signed in, redirect to sign-in
      logWithTs('[RootRedirect] User not signed in, redirecting to sign-in');
      router.replace('/sign-in');
    }
  }, [user, loading, router]);

  // Show loading while determining where to redirect — use app dark bg so
  // we don't flash a light screen before the authed dark UI takes over.
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#4C8CFF" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#050E1F',
  },
});
