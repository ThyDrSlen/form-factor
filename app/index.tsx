import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useAuth } from '../contexts/AuthContext';

export default function RootRedirect() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    if (user) {
      // User is signed in, redirect to tabs
      console.log('[RootRedirect] User signed in, redirecting to tabs');
      router.replace('/(tabs)');
    } else {
      // User is not signed in, redirect to sign-in
      console.log('[RootRedirect] User not signed in, redirecting to sign-in');
      router.replace('/sign-in');
    }
  }, [user, loading, router]);

  // Show loading while determining where to redirect
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#007AFF" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8F9FF',
  },
});
