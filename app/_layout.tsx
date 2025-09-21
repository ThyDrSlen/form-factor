import 'react-native-url-polyfill/auto';
import { Slot, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { FoodProvider } from '../contexts/FoodContext';
import { WorkoutsProvider } from '../contexts/WorkoutsContext';

// This layout wraps the entire app with the AuthProvider
function RootLayoutNav() {
  return (
    <AuthProvider>
      <WorkoutsProvider>
        <FoodProvider>
          <InitialLayout />
        </FoodProvider>
      </WorkoutsProvider>
    </AuthProvider>
  );
}

// This component handles the initial routing based on auth state
function InitialLayout() {
  const segments = useSegments();
  const inAuthGroup = segments[0] === '(auth)';
  const inTabsGroup = segments[0] === '(tabs)';
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) {
      console.log('[Layout] Auth is loading, waiting...');
      return;
    }

    console.log('[Layout] Routing check:', {
      user: !!user,
      segments,
      inAuthGroup,
      inTabsGroup,
      currentPath: segments.join('/'),
    });

    // Define allowed screens for authenticated users outside of tabs
    const allowedScreens = ['add-workout', 'add-food'];
    const currentScreen = segments[0];
    const isAllowedScreen = allowedScreens.includes(currentScreen);

    // If user is signed in but in auth group, redirect to tabs
    if (user && inAuthGroup) {
      console.log('[Layout] User signed in but in auth group, redirecting to tabs');
      router.replace('/(tabs)');
      return;
    }

    // If user is signed in but on root path, redirect to tabs
    if (user && segments.length === 0) {
      console.log('[Layout] User signed in on root, redirecting to tabs');
      router.replace('/(tabs)');
      return;
    }

    // If user is signed in but not in tabs group (and not in auth), only redirect if not on allowed screen
    if (user && !inTabsGroup && !inAuthGroup && !isAllowedScreen) {
      console.log('[Layout] User signed in but not in tabs or allowed screen, redirecting to tabs');
      router.replace('/(tabs)');
      return;
    }

    // If user is not signed in but not in auth group, redirect to sign-in
    if (!user && !inAuthGroup) {
      console.log('[Layout] User not signed in, redirecting to sign-in');
      router.replace('/sign-in');
      return;
    }

    console.log('[Layout] No redirect needed');
  }, [user, loading, segments, inAuthGroup, inTabsGroup, router]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return <Slot />;
}

export default RootLayoutNav;
