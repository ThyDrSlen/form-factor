import { ThemeProvider } from '@/design-system/ThemeProvider';
import { Slot, usePathname, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import 'react-native-gesture-handler';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-url-polyfill/auto';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { FoodProvider } from '../contexts/FoodContext';
import { WorkoutsProvider } from '../contexts/WorkoutsContext';
import { HealthKitProvider } from '../contexts/HealthKitContext';

// This layout wraps the entire app with providers
function RootLayoutNav() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <AuthProvider>
          <HealthKitProvider>
            <WorkoutsProvider>
              <FoodProvider>
                <InitialLayout />
              </FoodProvider>
            </WorkoutsProvider>
          </HealthKitProvider>
        </AuthProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

// This component handles the initial routing based on auth state
function InitialLayout() {
  const segments = useSegments();
  const inAuthGroup = segments[0] === '(auth)';
  const inTabsGroup = segments[0] === '(tabs)';
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const inModalsGroup = pathname.startsWith('/(modals)');

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
      pathname,
      inModalsGroup,
      currentPath: segments.join('/'),
    });

    // If user is signed in but in auth group, redirect to tabs
    if (user && inAuthGroup) {
      console.log('[Layout] User signed in but in auth group, redirecting to tabs');
      router.replace('/(tabs)');
      return;
    }

    // If user is signed in but on root path, redirect to tabs
    if (user && pathname === '/') {
      console.log('[Layout] User signed in on root, redirecting to tabs');
      router.replace('/(tabs)');
      return;
    }

    // Do not force redirect for other signed-in routes (e.g., modals or standalone flows)

    // If user is not signed in but not in auth group, redirect to sign-in
    if (!user && !inAuthGroup) {
      console.log('[Layout] User not signed in, redirecting to sign-in');
      router.replace('/sign-in');
      return;
    }

    console.log('[Layout] No redirect needed');
  }, [user, loading, segments, inAuthGroup, inTabsGroup, inModalsGroup, pathname, router]);

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
