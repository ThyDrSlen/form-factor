import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ProfileScreen from '@/app/(tabs)/profile';

const mockPush = jest.fn();
const mockSignOut = jest.fn();
const mockUpdateProfile = jest.fn();
const mockSaveGoals = jest.fn();
const mockUser = { id: 'member', email: 'member@example.com', user_metadata: { full_name: 'Member' } };
const mockSocial = { refreshPendingRequestCount: jest.fn(), pendingRequestCount: 0 };
const mockToast = { show: jest.fn() };
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));
jest.mock('@/features/auth/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser, signOut: mockSignOut, updateProfile: mockUpdateProfile }) }));
jest.mock('@/features/nutrition/contexts/NutritionGoalsContext', () => ({ useNutritionGoals: () => ({ goals: { calories: 2400 }, saveGoals: mockSaveGoals }) }));
jest.mock('@/features/social/contexts/SocialContext', () => ({ useSocial: () => mockSocial }));
jest.mock('@/contexts/ToastContext', () => ({ useToast: () => mockToast }));
jest.mock('@/lib/services/video-service', () => ({ listVideos: async () => [] }));
jest.mock('@/lib/services/social-service', () => ({ getProfile: async () => null, getFollowCounts: async () => ({ followers: 0, following: 0, pending_requests: 0 }) }));
jest.mock('@/lib/services/database/sync-service', () => ({ syncService: { getSyncStatus: () => ({ state: 'idle', queueSize: 0 }), onSyncStatusChange: () => () => {} } }));
jest.mock('@/lib/services/database/local-db', () => ({ localDB: {} }));
jest.mock('@/scripts/fix-invalid-uuids', () => ({ fixInvalidUUIDs: jest.fn() }));
jest.mock('@/features/form-tracking/hooks/use-debug-info', () => ({ useDebugInfo: () => ({ debugInfo: null, loading: false, refresh: jest.fn() }) }));
jest.mock('@/lib/video-comments-events', () => ({ subscribeToCommentEvents: () => () => {} }));
jest.mock('expo-video', () => ({ VideoView: () => null, useVideoPlayer: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: jest.requireActual('react-native').View }));

beforeEach(async () => {
  await AsyncStorage.setItem('onboarding_completed', 'true');
  await AsyncStorage.setItem('form_tracking_onboarding_dismissed', 'true');
  jest.clearAllMocks();
});

test.each([
  ['Replay app onboarding', { pathname: '/(onboarding)/welcome', params: { mode: 'replay' } }],
  ['Form check-in walkthrough', '/(modals)/form-tracking-setup'],
])('%s opens directly without erasing existing setup', async (label, destination) => {
  render(<ProfileScreen />);
  await act(async () => {});
  fireEvent.press(screen.getByText(label as string));
  expect(mockPush).toHaveBeenCalledWith(destination);
  expect(mockSignOut).not.toHaveBeenCalled();
  expect(mockUpdateProfile).not.toHaveBeenCalled();
  expect(mockSaveGoals).not.toHaveBeenCalled();
  expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
