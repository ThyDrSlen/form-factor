/**
 * workout-debrief-chat integration test (wave-25).
 *
 * Covers the four lifecycle scenarios called out in the task:
 *   1. Flag off → disabled card renders, coach not called.
 *   2. Flag on → first message renders after askAboutWorkout resolves.
 *   3. Send follow-up → askAboutWorkout is called with the trimmed user message.
 *   4. Close modal → router.back() is invoked on the close button.
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockRouterBack = jest.fn();
const mockAskAboutWorkout = jest.fn();
let mockEnabled = false;

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockRouterBack, push: jest.fn() }),
  useLocalSearchParams: () => ({ workoutId: 'w-1' }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('react-native-paper', () => {
  const ReactRef = require('react');
  const { TextInput: NativeTextInput } = require('react-native');
  return {
    TextInput: (props: Record<string, unknown>) => {
      const {
        value,
        onChangeText,
        testID,
        placeholder,
        mode: _mode,
        outlineColor: _outlineColor,
        activeOutlineColor: _activeOutlineColor,
        textColor: _textColor,
        theme: _theme,
        ...rnProps
      } = props as Record<string, unknown>;
      void _mode;
      void _outlineColor;
      void _activeOutlineColor;
      void _textColor;
      void _theme;
      return ReactRef.createElement(NativeTextInput, {
        testID,
        placeholder,
        value,
        onChangeText,
        ...rnProps,
      });
    },
  };
});

jest.mock('@/hooks/use-workout-coach-context', () => ({
  useWorkoutCoachContext: () => ({
    get enabled() {
      return mockEnabled;
    },
    loadContext: jest.fn(),
    askAboutWorkout: (...args: unknown[]) => mockAskAboutWorkout(...args),
  }),
}));

// eslint-disable-next-line import/first
import WorkoutDebriefChatModal from '../../../app/(modals)/workout-debrief-chat';

describe('WorkoutDebriefChatModal', () => {
  beforeEach(() => {
    mockRouterBack.mockReset();
    mockAskAboutWorkout.mockReset();
    mockEnabled = false;
  });

  it('renders the disabled fallback card when flag is off', () => {
    mockEnabled = false;
    const { getByTestId, queryByTestId } = render(<WorkoutDebriefChatModal />);
    expect(getByTestId('workout-debrief-chat-disabled')).toBeTruthy();
    expect(queryByTestId('workout-debrief-chat-root')).toBeNull();
    expect(mockAskAboutWorkout).not.toHaveBeenCalled();
  });

  it('renders the first assistant bubble once askAboutWorkout resolves (flag on)', async () => {
    mockEnabled = true;
    mockAskAboutWorkout.mockResolvedValue({
      role: 'assistant',
      content: "Here's your retrospective.",
    });

    const { findByText, getByTestId } = render(<WorkoutDebriefChatModal />);
    await waitFor(() => {
      expect(mockAskAboutWorkout).toHaveBeenCalledWith('w-1', '');
    });
    expect(await findByText("Here's your retrospective.")).toBeTruthy();
    expect(getByTestId('workout-debrief-chat-root')).toBeTruthy();
  });

  it('sends a follow-up when the user presses send', async () => {
    mockEnabled = true;
    mockAskAboutWorkout
      .mockResolvedValueOnce({ role: 'assistant', content: 'first reply' })
      .mockResolvedValueOnce({ role: 'assistant', content: 'follow-up reply' });

    const { findByText, getByTestId } = render(<WorkoutDebriefChatModal />);
    await findByText('first reply');

    const input = getByTestId('workout-debrief-chat-input');
    fireEvent.changeText(input, '  what about tempo?  ');
    await act(async () => {
      fireEvent.press(getByTestId('workout-debrief-chat-send'));
    });

    await waitFor(() => {
      expect(mockAskAboutWorkout).toHaveBeenCalledTimes(2);
    });
    expect(mockAskAboutWorkout.mock.calls[1]).toEqual(['w-1', 'what about tempo?']);
    expect(await findByText('follow-up reply')).toBeTruthy();
  });

  it('calls router.back() when the close button is pressed (cleanup)', async () => {
    mockEnabled = true;
    mockAskAboutWorkout.mockResolvedValue({ role: 'assistant', content: 'hi' });
    const { findByText, getByTestId } = render(<WorkoutDebriefChatModal />);
    // Wait for mount-time state update to settle first.
    await findByText('hi');
    fireEvent.press(getByTestId('workout-debrief-chat-close'));
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
  });
});
