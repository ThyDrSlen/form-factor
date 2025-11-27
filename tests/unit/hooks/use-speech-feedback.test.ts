import { renderHook, act } from '@testing-library/react-native';
import { useSpeechFeedback } from '@/hooks/use-speech-feedback';

// Mock expo-speech
const mockSpeak = jest.fn();
const mockStop = jest.fn();
jest.mock('expo-speech', () => ({
  speak: (text: string, options: any) => {
    mockSpeak(text, options);
    // Simulate immediate completion for testing
    if (options?.onDone) {
      setTimeout(() => options.onDone(), 10);
    }
  },
  stop: () => mockStop(),
}));

// Mock expo-av
const mockSetAudioModeAsync = jest.fn().mockResolvedValue(undefined);
jest.mock('expo-av', () => ({
  Audio: {
    setAudioModeAsync: (options: any) => mockSetAudioModeAsync(options),
  },
  InterruptionModeIOS: {
    MixWithOthers: 1,
  },
}));

// Mock react-native Platform
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

describe('useSpeechFeedback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('when disabled', () => {
    it('should not speak when disabled', () => {
      const { result } = renderHook(() =>
        useSpeechFeedback({ enabled: false })
      );

      act(() => {
        result.current.speak('Hello');
      });

      expect(mockSpeak).not.toHaveBeenCalled();
    });

    it('should stop any ongoing speech when disabled', () => {
      const { result, rerender } = renderHook(
        (props: { enabled: boolean }) => useSpeechFeedback({ enabled: props.enabled }),
        { initialProps: { enabled: true } }
      );

      // Disable
      rerender({ enabled: false });

      expect(mockStop).toHaveBeenCalled();
    });
  });

  describe('when enabled', () => {
    it('should speak the provided phrase', async () => {
      const { result } = renderHook(() =>
        useSpeechFeedback({ enabled: true, minIntervalMs: 0 })
      );

      await act(async () => {
        result.current.speak('Hello world');
        jest.advanceTimersByTime(50);
      });

      expect(mockSpeak).toHaveBeenCalledWith(
        'Hello world',
        expect.objectContaining({
          language: 'en-US',
          rate: 0.55,
          pitch: 1.0,
          volume: 1,
        })
      );
    });

    it('should not speak empty strings', async () => {
      const { result } = renderHook(() =>
        useSpeechFeedback({ enabled: true })
      );

      await act(async () => {
        result.current.speak('');
        result.current.speak('   ');
      });

      expect(mockSpeak).not.toHaveBeenCalled();
    });

    it('should respect minIntervalMs between phrases', async () => {
      const { result } = renderHook(() =>
        useSpeechFeedback({ enabled: true, minIntervalMs: 2000 })
      );

      await act(async () => {
        result.current.speak('First');
        jest.advanceTimersByTime(50);
      });

      expect(mockSpeak).toHaveBeenCalledTimes(1);

      await act(async () => {
        result.current.speak('Second');
        jest.advanceTimersByTime(100);
      });

      // Second should be queued, not spoken yet (within minInterval)
      expect(mockSpeak).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(2000);
      });

      // Now second should have been spoken
      expect(mockSpeak).toHaveBeenCalledTimes(2);
    });

    it('should not repeat the same phrase within minInterval', async () => {
      const { result } = renderHook(() =>
        useSpeechFeedback({ enabled: true, minIntervalMs: 2000 })
      );

      await act(async () => {
        result.current.speak('Same phrase');
        jest.advanceTimersByTime(50);
      });

      await act(async () => {
        result.current.speak('Same phrase');
        jest.advanceTimersByTime(100);
      });

      // Should only be called once
      expect(mockSpeak).toHaveBeenCalledTimes(1);
    });

    it('should use custom voice options', async () => {
      const { result } = renderHook(() =>
        useSpeechFeedback({
          enabled: true,
          minIntervalMs: 0,
          voiceId: 'com.apple.voice.enhanced.en-US.Samantha',
          language: 'en-GB',
          rate: 0.8,
          pitch: 1.2,
          volume: 0.5,
        })
      );

      await act(async () => {
        result.current.speak('Custom voice');
        jest.advanceTimersByTime(50);
      });

      expect(mockSpeak).toHaveBeenCalledWith(
        'Custom voice',
        expect.objectContaining({
          voice: 'com.apple.voice.enhanced.en-US.Samantha',
          language: 'en-GB',
          rate: 0.8,
          pitch: 1.2,
          volume: 0.5,
        })
      );
    });
  });

  describe('stop', () => {
    it('should stop speech and clear queue', async () => {
      const { result } = renderHook(() =>
        useSpeechFeedback({ enabled: true, minIntervalMs: 0 })
      );

      await act(async () => {
        result.current.speak('First');
        result.current.speak('Second');
        result.current.stop();
      });

      expect(mockStop).toHaveBeenCalled();
    });
  });

  describe('immediate option', () => {
    it('should add immediate phrases to front of queue', async () => {
      const { result } = renderHook(() =>
        useSpeechFeedback({ enabled: true, minIntervalMs: 0 })
      );

      // Queue up phrases before any are spoken
      await act(async () => {
        result.current.speak('Normal');
        // Normal starts speaking immediately, Urgent goes to front of remaining queue
        result.current.speak('Urgent', { immediate: true });
        result.current.speak('Last');
        jest.advanceTimersByTime(100);
      });

      // Normal was already being spoken when Urgent was added
      // Urgent should come before Last (second position, not third)
      const calls = mockSpeak.mock.calls.map((c) => c[0]);
      expect(calls[0]).toBe('Normal'); // Already started
      expect(calls[1]).toBe('Urgent'); // Jumped ahead of Last
      expect(calls[2]).toBe('Last');
    });
  });

  describe('audio mode', () => {
    it('should configure audio mode with recording allowed by default', async () => {
      renderHook(() =>
        useSpeechFeedback({ enabled: true, shouldAllowRecording: true })
      );

      await act(async () => {
        jest.advanceTimersByTime(50);
      });

      expect(mockSetAudioModeAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
        })
      );
    });

    it('should configure audio mode without recording when specified', async () => {
      renderHook(() =>
        useSpeechFeedback({ enabled: true, shouldAllowRecording: false })
      );

      await act(async () => {
        jest.advanceTimersByTime(50);
      });

      expect(mockSetAudioModeAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          allowsRecordingIOS: false,
        })
      );
    });
  });
});
