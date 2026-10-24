import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockLoadSession = jest.fn().mockResolvedValue(undefined);
const mockSessionState: any = { activeSession: null, error: null, loadActiveSession: mockLoadSession };
jest.mock('@/lib/stores/session-runner', () => ({
  useSessionRunner: Object.assign((selector: any) => selector(mockSessionState), { getState: () => mockSessionState }),
}));

import HomeScreen from '../../../app/(tabs)/index';

jest.mock('../../../features/auth/contexts/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));

jest.mock('../../../features/social/contexts/SocialContext', () => ({
  useSocial: () => ({ unreadSharesCount: 0 }),
}));

jest.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ show: jest.fn() }),
}));

jest.mock('../../../features/social/contexts/SocialContext', () => ({
  useSocial: () => ({ unreadSharesCount: 0 }),
}));

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('@react-navigation/bottom-tabs', () => ({
  useBottomTabBarHeight: () => 0,
}));

jest.mock('@/features/health/components/DashboardHealth', () => ({
  DashboardHealth: () => null,
}));

jest.mock('@/lib/services/video-service', () => ({
  listVideos: jest.fn().mockResolvedValue([]),
  deleteVideo: jest.fn(),
  getVideoById: jest.fn().mockResolvedValue({ id: 'video-1', comment_count: 0, like_count: 0 }),
  toggleVideoLike: jest.fn(),
  uploadWorkoutVideo: jest.fn(),
}));

jest.mock('@/lib/video-comments-events', () => ({
  subscribeToCommentEvents: jest.fn(() => () => {}),
}));

jest.mock('@/lib/services/coach-service', () => ({
  sendCoachPrompt: jest.fn(),
}));

jest.mock('expo-video', () => {
  const React = require('react');
  const { View } = require('react-native');

  return {
    VideoView: React.forwardRef((props: any, ref: any) => <View {...props} ref={ref} />),
    useVideoPlayer: () => ({
      loop: false,
      duration: 0,
      muted: false,
      playing: false,
      timeUpdateEventInterval: 0,
      replaceAsync: jest.fn().mockResolvedValue(undefined),
      addListener: jest.fn(() => ({ remove: jest.fn() })),
      play: jest.fn(),
      pause: jest.fn(),
      currentTime: 0,
    }),
  };
});

describe('HomeScreen video feed', () => {
  it('labels the action Resume only after the persisted active workout has loaded', async () => {
    let finishLoad!: () => void;
    mockLoadSession.mockImplementationOnce(() => new Promise<void>(resolve => { finishLoad = resolve; }));
    const screen = render(<HomeScreen />);
    expect(screen.queryByText('Start workout')).toBeNull();
    expect(mockLoadSession).toHaveBeenCalled();
    await act(async () => {
      mockSessionState.activeSession = { id: 'restored' };
      finishLoad();
    });
    expect(screen.getByLabelText('Resume workout')).toBeTruthy();
    mockSessionState.activeSession = null;
  });
  it('keeps dashboard content in a scrollable area above navigation', () => {
    const { getByTestId, getByText } = render(<HomeScreen />);
    expect(getByTestId('home-dashboard-scroll')).toBeTruthy();
    expect(getByText('Quick Actions')).toBeTruthy();
    expect(getByText('This Week')).toBeTruthy();
  });

  it('does not render Following/Trending tabs', async () => {
    const { getByText, queryByText } = render(<HomeScreen />);

    fireEvent.press(getByText('Feed'));

    expect(queryByText('Following')).toBeNull();
    expect(queryByText('Trending')).toBeNull();

    await waitFor(
      () => {
        expect(getByText('No posts in your social feed yet.')).toBeTruthy();
      },
      { timeout: 10000 }
    );
  }, 10000);
});
