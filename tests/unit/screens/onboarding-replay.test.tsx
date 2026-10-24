import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import WelcomeScreen from '@/app/(onboarding)/welcome';
import ProfileSetupScreen from '@/app/(onboarding)/profile-setup';
import NutritionGoalsScreen from '@/app/(onboarding)/nutrition-goals';

const mockRouter = { replace: jest.fn(), push: jest.fn() };
const mockUpdateProfile = jest.fn().mockResolvedValue({});
const mockToggleWeightUnit = jest.fn();
const mockSaveGoals = jest.fn().mockResolvedValue({});
const mockSafeBack = jest.fn();
let mockGoals: { calories: number; protein: number } | null = { calories: 2400, protein: 150 };
let mockMode: string | undefined = 'replay';
let mockUser: { id: string; user_metadata: { full_name: string } } | null = {
  id: 'member', user_metadata: { full_name: 'Existing Member' },
};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ mode: mockMode }),
}));
jest.mock('@/features/auth/contexts/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, updateProfile: mockUpdateProfile }),
}));
jest.mock('@/contexts/UnitsContext', () => ({
  useUnits: () => ({ weightUnit: 'kg', toggleWeightUnit: mockToggleWeightUnit }),
}));
jest.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ show: jest.fn() }) }));
jest.mock('@/features/nutrition/contexts/NutritionGoalsContext', () => ({
  useNutritionGoals: () => ({ goals: mockGoals, saveGoals: mockSaveGoals, isSyncing: false, loading: false }),
}));
jest.mock('@/hooks/use-safe-back', () => ({ useSafeBack: () => mockSafeBack }));
jest.mock('@/lib/services/onboarding-analytics', () => ({ trackOnboardingEvent: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/BrandMark', () => ({ BrandMark: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: jest.requireActual('react-native').View,
}));

beforeEach(async () => {
  await AsyncStorage.setItem('onboarding_completed', 'true');
  await AsyncStorage.setItem('welcome_screen_seen', 'true');
  await AsyncStorage.setItem('@fitness_goal', 'strength');
  jest.clearAllMocks();
  mockMode = 'replay';
  mockGoals = { calories: 2400, protein: 150 };
  mockUser = { id: 'member', user_metadata: { full_name: 'Existing Member' } };
});

test('signed-in replay continues to profile setup without auth routes or storage writes', async () => {
  render(<WelcomeScreen />);
  await act(async () => fireEvent.press(screen.getByText(/^(Get Started|Continue)$/)));
  expect(mockRouter.replace).toHaveBeenCalledWith('/(onboarding)/profile-setup?mode=replay');
  expect(screen.queryByText('I already have an account')).toBeNull();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem('onboarding_completed')).toBe('true');
});

test('profile replay continues without overwriting existing account or fitness goal', async () => {
  render(<ProfileSetupScreen />);
  await act(async () => fireEvent.press(screen.getByText('Continue')));
  expect(mockRouter.replace).toHaveBeenCalledWith('/(onboarding)/nutrition-goals?mode=replay');
  expect(mockUpdateProfile).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem('@fitness_goal')).toBe('strength');
});

test('profile replay can close directly to Profile without saving', async () => {
  render(<ProfileSetupScreen />);
  await act(async () => fireEvent.press(screen.getByLabelText('Back to Profile')));
  expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/profile');
  expect(mockUpdateProfile).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('nutrition replay finishes at Profile without saving or resetting completion', async () => {
  render(<NutritionGoalsScreen />);
  expect(screen.getByLabelText('Daily calorie target in kilocalories').props.value).toBe('2400');
  await act(async () => fireEvent.press(screen.getByText(/^(Save Goals|Finish walkthrough)$/)));
  expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/profile');
  expect(mockSaveGoals).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(mockSafeBack).not.toHaveBeenCalled();
});

test('skipping replay with no goals never inserts default nutrition goals', async () => {
  mockGoals = null;
  render(<NutritionGoalsScreen />);
  await act(async () => fireEvent.press(screen.getByText('Skip for now')));
  expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/profile');
  expect(mockSaveGoals).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test.each([WelcomeScreen, NutritionGoalsScreen])('%p cancels replay to Profile', async (Screen) => {
  render(<Screen />);
  await act(async () => fireEvent.press(screen.getByLabelText('Back to Profile')));
  expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/profile');
  expect(mockSaveGoals).not.toHaveBeenCalled();
  expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
});

test('profile replay skip retains the replay mode and saved preferences', async () => {
  render(<ProfileSetupScreen />);
  await act(async () => {});
  expect(screen.getByLabelText('Strength').props.accessibilityState.checked).toBe(true);
  fireEvent.press(screen.getByText('lbs'));
  expect(mockToggleWeightUnit).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Skip for now'));
  expect(mockRouter.replace).toHaveBeenCalledWith('/(onboarding)/nutrition-goals?mode=replay');
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('replay can finish even if the completed user has no nutrition goals', async () => {
  mockGoals = null;
  render(<NutritionGoalsScreen />);
  await act(async () => fireEvent.press(screen.getByText('Finish walkthrough')));
  expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/profile');
  expect(mockSaveGoals).not.toHaveBeenCalled();
});

test('ordinary nutrition setup still saves goals and completes onboarding', async () => {
  mockMode = undefined;
  render(<NutritionGoalsScreen />);
  await act(async () => fireEvent.press(screen.getByText('Save Goals')));
  expect(mockSaveGoals).toHaveBeenCalledWith({ calories: 2400, protein: 150, carbs: undefined, fat: undefined });
  expect(AsyncStorage.setItem).toHaveBeenCalledWith('onboarding_completed', 'true');
  expect(mockSafeBack).toHaveBeenCalled();
});

test('signed-out welcome preserves sign-up navigation even with a replay query', async () => {
  mockUser = null;
  render(<WelcomeScreen />);
  await act(async () => fireEvent.press(screen.getByText('Get Started')));
  expect(mockRouter.replace).toHaveBeenCalledWith('/sign-up');
});
