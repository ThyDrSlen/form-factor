import './global.css';
import { Slot, usePathname, useRouter, useSegments } from 'expo-router';
import * as Linking from 'expo-linking';
import React, { Component, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View, Text as RNText, StyleSheet, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import 'react-native-url-polyfill/auto';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { FoodProvider } from '../contexts/FoodContext';
import { NutritionGoalsProvider, useNutritionGoals } from '../contexts/NutritionGoalsContext';
import { WorkoutsProvider } from '../contexts/WorkoutsContext';
import { HealthKitProvider } from '../contexts/HealthKitContext';
import { UnitsProvider } from '../contexts/UnitsContext';
import { NetworkProvider } from '../contexts/NetworkContext';
import { SocialProvider } from '../contexts/SocialContext';
import { useFonts, Lexend_400Regular, Lexend_500Medium, Lexend_700Bold } from '@expo-google-fonts/lexend';
import { ToastProvider } from '../contexts/ToastContext';
import { HapticPreferencesProvider } from '../contexts/HapticPreferencesContext';
import { VoiceControlProvider } from '../contexts/VoiceControlContext';
import { isVoiceControlPipelineEnabled } from '@/lib/services/voice-pipeline-flag';
import { logWithTs, warnWithTs } from '@/lib/logger';
import { isOnboardingCompleted } from '@/lib/services/onboarding';
import { hasSeenWelcome } from '@/app/(onboarding)/welcome';
import { MilestoneToastBridge } from '@/components/MilestoneToastBridge';
import { SessionTelemetryBinder } from '@/components/telemetry/SessionTelemetryBinder';
import { parseTemplateIdFromUrl } from '@/lib/services/workout-scheduler';
import '@/lib/services/fault-explainer-bootstrap';

// Error boundary to catch crashes in the provider tree or layout
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class RootErrorBoundary extends Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorContainer}>
          <RNText style={styles.errorTitle}>Something went wrong</RNText>
          <RNText style={styles.errorMessage}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </RNText>
          <Pressable style={styles.errorButton} onPress={this.handleReset}>
            <RNText style={styles.errorButtonText}>Try Again</RNText>
          </Pressable>
        </View>
      );
    }

    return this.props.children;
  }
}

/**
 * Wraps children with VoiceControlProvider when
 * EXPO_PUBLIC_VOICE_CONTROL_PIPELINE is on; otherwise falls through so the
 * provider tree looks exactly like it did before wave 24 PR-β. Evaluated
 * once per mount — the flag is read from module scope and never flips at
 * runtime.
 */
function MaybeVoiceControlProvider({ children }: { children: React.ReactNode }) {
  if (!isVoiceControlPipelineEnabled()) {
    return <>{children}</>;
  }
  return <VoiceControlProvider>{children}</VoiceControlProvider>;
}

// This layout wraps the entire app with providers
function RootLayoutNav() {
  // Load Lexend fonts globally
  const [fontsLoaded] = useFonts({ Lexend_400Regular, Lexend_500Medium, Lexend_700Bold });
  const fontStyleAppliedRef = useRef(false);

  // Apply global default font family ONCE after fonts load (moved out of render to avoid Hermes issues)
  useEffect(() => {
    if (fontsLoaded && RNText && !fontStyleAppliedRef.current) {
      fontStyleAppliedRef.current = true;
      try {
        const AnyText = RNText as any;
        const existingProps = AnyText.defaultProps || {};
        const existingStyle = existingProps.style;
        const mergedStyle = [
          { fontFamily: 'Lexend_400Regular' },
          ...(Array.isArray(existingStyle) ? existingStyle : existingStyle ? [existingStyle] : []),
        ];
        AnyText.defaultProps = { ...existingProps, style: mergedStyle };
      } catch (e) {
        if (__DEV__) {
          warnWithTs('[Layout] Failed to apply default font style:', e);
        }
      }
    }
  }, [fontsLoaded]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <RootErrorBoundary>
        <BottomSheetModalProvider>
          <ToastProvider>
            <HapticPreferencesProvider>
              <AuthProvider>
                <MaybeVoiceControlProvider>
                  <NetworkProvider>
                    <UnitsProvider>
                      <HealthKitProvider>
                        <WorkoutsProvider>
                          <NutritionGoalsProvider>
                            <SocialProvider>
                              <FoodProvider>
                                {!fontsLoaded ? (
                                  <View style={styles.splash}>
                                    <ActivityIndicator color="#4C8CFF" />
                                  </View>
                                ) : (
                                  <>
                                    <SessionTelemetryBinder />
                                    <MilestoneToastBridge />
                                    <InitialLayout />
                                  </>
                                )}
                              </FoodProvider>
                            </SocialProvider>
                          </NutritionGoalsProvider>
                        </WorkoutsProvider>
                      </HealthKitProvider>
                    </UnitsProvider>
                  </NetworkProvider>
                </MaybeVoiceControlProvider>
              </AuthProvider>
            </HapticPreferencesProvider>
          </ToastProvider>
        </BottomSheetModalProvider>
      </RootErrorBoundary>
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
  const publicRoutes = ['/landing', '/reset-password'];
  const isPublicRoute = publicRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
  const isWebRootLanding = Platform.OS === 'web' && pathname === '/';
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const [welcomeSeen, setWelcomeSeen] = useState<boolean | null>(null);

  useEffect(() => {
    hasSeenWelcome().then(setWelcomeSeen);
  }, []);

  // Deep-link handler — issue #447 W3-C item #4. Routes
  // `form-factor://scan?templateId=xxx` to the scan tab with the templateId
  // query preserved so `app/(tabs)/scan-arkit.tsx` can hydrate form-targets
  // from the session-runner store. Applies to cold-start (getInitialURL)
  // and mid-session URL events (addEventListener).
  useEffect(() => {
    let cancelled = false;

    const routeToScan = (templateId: string) => {
      logWithTs('[Layout] Deep-link → scan', { templateId });
      const safe = encodeURIComponent(templateId);
      router.push(`/(tabs)/scan-arkit?templateId=${safe}` as never);
    };

    const handleUrl = (url: string | null) => {
      if (!url || cancelled) return;
      const tid = parseTemplateIdFromUrl(url);
      if (tid) routeToScan(tid);
    };

    Linking.getInitialURL()
      .then(handleUrl)
      .catch((err) => warnWithTs('[Layout] getInitialURL failed', err));

    const sub = Linking.addEventListener('url', (event) => {
      handleUrl(event.url);
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [router]);

  useEffect(() => {
    if (user) {
      isOnboardingCompleted()
        .then(setOnboardingDone)
        .catch((err) => {
          console.error('[Layout] Failed to check onboarding status:', err);
          setOnboardingDone(false);
        });
    } else {
      setOnboardingDone(null);
    }
  }, [user]);

  useEffect(() => {
    if (loading || goalsLoading || welcomeSeen === null || (user && onboardingDone === null)) {
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
      onboardingDone,
      welcomeSeen,
      currentPath: segments.join('/'),
    });

    if (!user && isWebRootLanding) {
      logWithTs('[Layout] Web root detected, redirecting to landing');
      router.replace('/landing');
      return;
    }

    if (user && !onboardingDone && !goals && !inOnboardingGroup) {
      logWithTs('[Layout] Onboarding not completed, redirecting to onboarding');
      router.replace('/(onboarding)/nutrition-goals');
      return;
    }

    if (user && (onboardingDone || goals) && inOnboardingGroup) {
      logWithTs('[Layout] Onboarding done, redirecting to tabs');
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

    // If user is not signed in but not in auth/onboarding group, redirect appropriately
    if (!user && !inAuthGroup && !inOnboardingGroup && !inModalsGroup && !isPublicRoute) {
      if (!welcomeSeen) {
        logWithTs('[Layout] New user, redirecting to welcome');
        router.replace('/(onboarding)/welcome');
      } else {
        logWithTs('[Layout] User not signed in, redirecting to sign-in');
        router.replace('/sign-in');
      }
      return;
    }

    logWithTs('[Layout] No redirect needed');
  }, [user, loading, goalsLoading, goals, onboardingDone, welcomeSeen, segments, inAuthGroup, inTabsGroup, inOnboardingGroup, inModalsGroup, isPublicRoute, isWebRootLanding, pathname, router]);

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
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#050E1F',
    padding: 24,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  errorButton: {
    backgroundColor: '#4C8CFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  errorButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
