import React from 'react';
import { act, render } from '@testing-library/react-native';
import RootLayout from '@/app/_layout';

const mockRouter = { replace: jest.fn(), push: jest.fn() };
let mockMode: string | undefined = 'replay';
let mockDone = true;
let mockGoals: object | null = { calories: 2400 };
const mockSegments = ['(onboarding)', 'welcome'];
const mockUser = { id: 'member' };

jest.mock('expo-router', () => ({
  Slot: () => null,
  useRouter: () => mockRouter,
  useSegments: () => mockSegments,
  usePathname: () => '/welcome',
  useGlobalSearchParams: () => ({ mode: mockMode }),
}));
jest.mock('@/app/global.css', () => ({}));
jest.mock('@/lib/services/fault-explainer-bootstrap', () => ({}));
jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), warnWithTs: jest.fn() }));
jest.mock('@/lib/services/voice-pipeline-flag', () => ({ isVoiceControlPipelineEnabled: () => false }));
jest.mock('@/features/voice/contexts/VoiceControlContext', () => ({ VoiceControlProvider: ({ children }: any) => children }));
jest.mock('@/features/auth/contexts/AuthContext', () => ({ AuthProvider: ({ children }: any) => children, useAuth: () => ({ user: mockUser, loading: false }) }));
jest.mock('@/features/nutrition/contexts/NutritionGoalsContext', () => ({ NutritionGoalsProvider: ({ children }: any) => children, useNutritionGoals: () => ({ goals: mockGoals, loading: false }) }));
jest.mock('@/features/nutrition/contexts/FoodContext', () => ({ FoodProvider: ({ children }: any) => children }));
jest.mock('@/features/health/contexts/HealthKitContext', () => ({ HealthKitProvider: ({ children }: any) => children }));
jest.mock('@/features/workouts/contexts/WorkoutsContext', () => ({ WorkoutsProvider: ({ children }: any) => children }));
jest.mock('@/features/social/contexts/SocialContext', () => ({ SocialProvider: ({ children }: any) => children }));
jest.mock('@/contexts/UnitsContext', () => ({ UnitsProvider: ({ children }: any) => children }));
jest.mock('@/contexts/NetworkContext', () => ({ NetworkProvider: ({ children }: any) => children }));
jest.mock('@/contexts/ToastContext', () => ({ ToastProvider: ({ children }: any) => children }));
jest.mock('@/contexts/HapticPreferencesContext', () => ({ HapticPreferencesProvider: ({ children }: any) => children }));
jest.mock('@gorhom/bottom-sheet', () => ({ BottomSheetModalProvider: ({ children }: any) => children }));
jest.mock('react-native-gesture-handler', () => ({ GestureHandlerRootView: ({ children }: any) => children }));
jest.mock('@expo-google-fonts/lexend', () => ({ useFonts: () => [true] }));
jest.mock('@/features/form-tracking/components/MilestoneToastBridge', () => ({ MilestoneToastBridge: () => null }));
jest.mock('@/features/form-tracking/components/SessionTelemetryBinder', () => ({ SessionTelemetryBinder: () => null }));
jest.mock('@/lib/services/workout-scheduler', () => ({ parseTemplateIdFromUrl: () => null }));
jest.mock('@/lib/services/notifications', () => ({ handleNotificationResponse: jest.fn(), syncPushTokenRefreshListener: () => undefined }));
jest.mock('expo-linking', () => ({ getInitialURL: async () => null, addEventListener: () => ({ remove: jest.fn() }) }));
jest.mock('expo-notifications', () => ({ addNotificationResponseReceivedListener: () => ({ remove: jest.fn() }) }));
jest.mock('@/app/(onboarding)/welcome', () => ({ hasSeenWelcome: async () => true }));
jest.mock('@/lib/services/onboarding', () => ({
  ...jest.requireActual('@/lib/services/onboarding'),
  isOnboardingCompleted: async () => mockDone,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockMode = 'replay';
  mockDone = true;
  mockGoals = { calories: 2400 };
});

test('completed member stays in explicitly requested onboarding replay', async () => {
  render(<RootLayout />);
  await act(async () => {});
  expect(mockRouter.replace).not.toHaveBeenCalled();
});

test('completed member still redirects out of ordinary onboarding', async () => {
  mockMode = undefined;
  render(<RootLayout />);
  await act(async () => {});
  expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)');
});

test('existing goals also allow explicit replay before the completed flag is set', async () => {
  mockDone = false;
  render(<RootLayout />);
  await act(async () => {});
  expect(mockRouter.replace).not.toHaveBeenCalled();
});
