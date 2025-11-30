import './global.css';
import { Slot, usePathname, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View, Text as RNText, StyleSheet, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-url-polyfill/auto';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { FoodProvider } from '../contexts/FoodContext';
import { WorkoutsProvider } from '../contexts/WorkoutsContext';
import { HealthKitProvider } from '../contexts/HealthKitContext';
import { UnitsProvider } from '../contexts/UnitsContext';
import { NetworkProvider } from '../contexts/NetworkContext';
import { useFonts, Lexend_400Regular, Lexend_500Medium, Lexend_700Bold } from '@expo-google-fonts/lexend';
import { ToastProvider } from '../contexts/ToastContext';

// This layout wraps the entire app with providers
function RootLayoutNav() {
  // Load Lexend fonts globally
  const [fontsLoaded] = useFonts({ Lexend_400Regular, Lexend_500Medium, Lexend_700Bold });

  if (fontsLoaded && RNText) {
    // Apply a global default font family (non-destructive merge)
    // Note: this affects only Text components that don't explicitly override fontFamily
    const AnyText = RNText as any;
    AnyText.defaultProps = AnyText.defaultProps || {};
    AnyText.defaultProps.style = [
      { fontFamily: 'Lexend_400Regular' },
      Array.isArray(AnyText.defaultProps.style) ? AnyText.defaultProps.style : AnyText.defaultProps.style,
    ];
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <ToastProvider>
        <AuthProvider>
          <NetworkProvider>
            <UnitsProvider>
              <HealthKitProvider>
                <WorkoutsProvider>
                  <FoodProvider>
                    {!fontsLoaded ? (
                      <View style={styles.splash}>
                        <ActivityIndicator color="#4C8CFF" />
                      </View>
                    ) : (
                      <InitialLayout />
                    )}
                  </FoodProvider>
                </WorkoutsProvider>
              </HealthKitProvider>
            </UnitsProvider>
          </NetworkProvider>
        </AuthProvider>
      </ToastProvider>
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
  const publicRoutes = ['/landing'];
  const isPublicRoute = publicRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
  const isWebRootLanding = Platform.OS === 'web' && pathname === '/';

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

    if (!user && isWebRootLanding) {
      console.log('[Layout] Web root detected, redirecting to landing');
      router.replace('/landing');
      return;
    }

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
    if (!user && !inAuthGroup && !inModalsGroup && !isPublicRoute) {
      console.log('[Layout] User not signed in, redirecting to sign-in');
      router.replace('/sign-in');
      return;
    }

    console.log('[Layout] No redirect needed');
  }, [user, loading, segments, inAuthGroup, inTabsGroup, inModalsGroup, isPublicRoute, isWebRootLanding, pathname, router]);

  if (loading) {
    return (
      <View style={styles.authLoading}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return <Slot />;
}

export default RootLayoutNav;

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#050E1F',
  },
  authLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
