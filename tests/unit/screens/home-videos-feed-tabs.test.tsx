import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import HomeScreen from '../../../app/(tabs)/index';

jest.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));

jest.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ show: jest.fn() }),
}));

jest.mock('expo-router', () => ({
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

jest.mock('@/components', () => ({
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
  it('does not render Following/Trending tabs', async () => {
    const { getByText, queryByText } = render(<HomeScreen />);

    fireEvent.press(getByText('Videos'));

    expect(queryByText('Following')).toBeNull();
    expect(queryByText('Trending')).toBeNull();

    await waitFor(() => {
      expect(getByText('No videos yet. Share a set to see it here.')).toBeTruthy();
    });
  });
});
