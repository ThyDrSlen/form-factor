import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

const mockPlayer = { loop: false, play: jest.fn(), release: jest.fn() };
const mockUseVideoPlayer = jest.fn((_uri, setup) => { setup(mockPlayer); return mockPlayer; });
jest.mock('expo-video', () => ({
  useVideoPlayer: (uri: string, setup: (player: typeof mockPlayer) => void) => mockUseVideoPlayer(uri, setup),
  VideoView: (props: object) => {
    const { View } = jest.requireActual('react-native');
    return <View {...props} />;
  },
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }) }));

import { RecordingReview } from '@/features/form-tracking/components/RecordingReview';

const props = {
  uri: 'file:///set.mov', exercise: 'Pull-Up', reps: 4, score: '44', duration: '27s',
  primaryLabel: 'Avg elbow', primaryValue: '--', secondaryLabel: 'Avg shoulder', secondaryValue: '--',
  quality: 'High', size: '25 MB', error: null, uploading: false, saving: false,
  onPublish: jest.fn(), onSave: jest.fn(), onDiscard: jest.fn(),
};

describe('RecordingReview', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps playback still on open and stable across save-state updates', () => {
    const screen = render(<RecordingReview {...props} />);
    expect(mockPlayer.play).not.toHaveBeenCalled();
    const initialCalls = mockUseVideoPlayer.mock.calls.length;
    screen.rerender(<RecordingReview {...props} saving />);
    expect(mockUseVideoPlayer).toHaveBeenCalledTimes(initialCalls);
    screen.unmount();
    expect(mockPlayer.release).not.toHaveBeenCalled();
  });

  it('hides missing measurements and distinguishes video quality from form score', () => {
    const screen = render(<RecordingReview {...props} />);
    expect(screen.queryByText('Avg elbow')).toBeNull();
    expect(screen.queryByText('Avg shoulder')).toBeNull();
    expect(screen.getByText('High video quality · 25 MB')).toBeTruthy();
    expect(screen.getByText('44')).toBeTruthy();
  });

  it('keeps save, publish and discard separate and blocks repeat actions while busy', () => {
    const screen = render(<RecordingReview {...props} />);
    fireEvent.press(screen.getByLabelText('Save only'));
    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(props.onPublish).not.toHaveBeenCalled();
    fireEvent.press(screen.getByLabelText('Publish + Save'));
    fireEvent.press(screen.getByLabelText('Delete local copy'));
    expect(props.onPublish).toHaveBeenCalledTimes(1);
    expect(props.onDiscard).toHaveBeenCalledTimes(1);
    screen.rerender(<RecordingReview {...props} uploading />);
    fireEvent.press(screen.getByLabelText('Publish + Save'));
    fireEvent.press(screen.getByLabelText('Save only'));
    fireEvent.press(screen.getByLabelText('Delete local copy'));
    expect(props.onPublish).toHaveBeenCalledTimes(1);
    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(props.onDiscard).toHaveBeenCalledTimes(1);
  });
});
