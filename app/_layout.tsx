import './global.css';
import { Slot, usePathname, useRouter, useSegments } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, View, Text as RNText, StyleSheet, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-url-polyfill/auto';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { FoodProvider } from '../contexts/FoodContext';
import { NutritionGoalsProvider, useNutritionGoals } from '../contexts/NutritionGoalsContext';
import { WorkoutsProvider } from '../contexts/WorkoutsContext';
import { HealthKitProvider } from '../contexts/HealthKitContext';
import { UnitsProvider } from '../contexts/UnitsContext';
import { NetworkProvider } from '../contexts/NetworkContext';
import { useFonts, Lexend_400Regular, Lexend_500Medium, Lexend_700Bold } from '@expo-google-fonts/lexend';
import { ToastProvider } from '../contexts/ToastContext';
import { logWithTs, warnWithTs } from '@/lib/logger';
import { createError, logError } from '@/lib/services/ErrorHandler';

function reportIngestError(location: string, error: unknown): void {
  logError(
    createError('network', 'DEBUG_INGEST_FAILED', 'Failed to send local debug ingest event', {
      details: { location, error },
      severity: 'info',
      retryable: true,
    }),
    {
      feature: 'app',
      location,
    }
  );
}

// #region agent log
fetch('http://127.0.0.1:7242/ingest/8fe7b778-fa45-419b-917f-0b8c3047244f',{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({
    sessionId:'debug-session',
    runId:'run1',
    hypothesisId:'H_entry',
    location:'app/_layout.tsx:module',
    message:'module loaded',
    data:{},
    timestamp:Date.now()
  })
}).catch((error) => {
  reportIngestError('app/_layout.tsx:module', error);
});
// #endregion

// This layout wraps the entire app with providers
function RootLayoutNav() {
  // Load Lexend fonts globally
  const [fontsLoaded] = useFonts({ Lexend_400Regular, Lexend_500Medium, Lexend_700Bold });
  const fontStyleAppliedRef = useRef(false);

  // Apply global default font family ONCE after fonts load (moved out of render to avoid Hermes issues)
  useEffect(() => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/8fe7b778-fa45-419b-917f-0b8c3047244f',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        sessionId:'debug-session',
        runId:'run1',
        hypothesisId:'H_font',
        location:'app/_layout.tsx:useEffect fonts',
        message:'font effect check',
        data:{ fontsLoaded, alreadyApplied:fontStyleAppliedRef.current },
        timestamp:Date.now()
      })
    }).catch((error) => {
      reportIngestError('app/_layout.tsx:useEffect fonts check', error);
    });
    // #endregion
    if (fontsLoaded && RNText && !fontStyleAppliedRef.current) {
      fontStyleAppliedRef.current = true;
      try {
        const AnyText = RNText as any;
        const existingProps = AnyText.defaultProps || {};
        const existingStyle = existingProps.style;
        // Safely merge existing styles - fix the broken ternary that always returned the same value
        const mergedStyle = [
          { fontFamily: 'Lexend_400Regular' },
          ...(Array.isArray(existingStyle) ? existingStyle : existingStyle ? [existingStyle] : []),
        ];
        AnyText.defaultProps = { ...existingProps, style: mergedStyle };
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/8fe7b778-fa45-419b-917f-0b8c3047244f',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({
            sessionId:'debug-session',
            runId:'run1',
            hypothesisId:'H_font',
            location:'app/_layout.tsx:useEffect fonts',
            message:'font defaults applied',
            data:{ mergedStyleLength:mergedStyle.length },
            timestamp:Date.now()
          })
        }).catch((error) => {
          reportIngestError('app/_layout.tsx:font defaults applied', error);
        });
        // #endregion
      } catch (e) {
        // Silently fail - font styling is not critical
        if (__DEV__) {
          warnWithTs('[Layout] Failed to apply default font style:', e);
        }
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/8fe7b778-fa45-419b-917f-0b8c3047244f',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({
            sessionId:'debug-session',
            runId:'run1',
            hypothesisId:'H_font',
            location:'app/_layout.tsx:useEffect fonts',
            message:'font defaults error',
            data:{ error: e instanceof Error ? e.message : String(e) },
            timestamp:Date.now()
          })
        }).catch((error) => {
          reportIngestError('app/_layout.tsx:font defaults error', error);
        });
        // #endregion
      }
    }
  }, [fontsLoaded]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <ToastProvider>
        <AuthProvider>
          <NetworkProvider>
            <UnitsProvider>
              <HealthKitProvider>
                <WorkoutsProvider>
                  <NutritionGoalsProvider>
                    <FoodProvider>
                      {!fontsLoaded ? (
                        <View style={styles.splash}>
                          <ActivityIndicator color="#4C8CFF" />
                        </View>
                      ) : (
                        <InitialLayout />
                      )}
                    </FoodProvider>
                  </NutritionGoalsProvider>
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
  const inOnboardingGroup = segments[0] === '(onboarding)';
  const { user, loading } = useAuth();
  const { goals, loading: goalsLoading } = useNutritionGoals();
  const router = useRouter();
  const pathname = usePathname();
  const inModalsGroup = pathname.startsWith('/(modals)');
  const publicRoutes = ['/landing'];
  const isPublicRoute = publicRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
  const isWebRootLanding = Platform.OS === 'web' && pathname === '/';

  useEffect(() => {
    if (loading || goalsLoading) {
      logWithTs('[Layout] Auth is loading, waiting...');
      return;
    }

    logWithTs('[Layout] Routing check:', {
      user: !!user,
      segments,
      inAuthGroup,
      inTabsGroup,
      pathname,
      inModalsGroup,
      currentPath: segments.join('/'),
    });

    if (!user && isWebRootLanding) {
      logWithTs('[Layout] Web root detected, redirecting to landing');
      router.replace('/landing');
      return;
    }

    if (user && !goals && !inOnboardingGroup) {
      logWithTs('[Layout] Missing nutrition goals, redirecting to onboarding');
      router.replace('/(onboarding)/nutrition-goals');
      return;
    }

    if (user && goals && inOnboardingGroup) {
      logWithTs('[Layout] Goals configured, redirecting to tabs');
      router.replace('/(tabs)');
      return;
    }

    // If user is signed in but in auth group, redirect to tabs
    if (user && inAuthGroup) {
      logWithTs('[Layout] User signed in but in auth group, redirecting to tabs');
      router.replace('/(tabs)');
      return;
    }

    // If user is signed in but on root path, redirect to tabs
    if (user && pathname === '/') {
      logWithTs('[Layout] User signed in on root, redirecting to tabs');
      router.replace('/(tabs)');
      return;
    }

    // Do not force redirect for other signed-in routes (e.g., modals or standalone flows)

    // If user is not signed in but not in auth group, redirect to sign-in
    if (!user && !inAuthGroup && !inModalsGroup && !isPublicRoute) {
      logWithTs('[Layout] User not signed in, redirecting to sign-in');
      router.replace('/sign-in');
      return;
    }

    logWithTs('[Layout] No redirect needed');
  }, [user, loading, goalsLoading, goals, segments, inAuthGroup, inTabsGroup, inOnboardingGroup, inModalsGroup, isPublicRoute, isWebRootLanding, pathname, router]);

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
