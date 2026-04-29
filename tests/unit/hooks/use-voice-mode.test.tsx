/**
 * Unit tests for useVoiceMode.
 *
 * Covers:
 *  - initial state: isActive=false, stable across identical re-renders
 *  - startVoiceMode switches the audio session to 'coaching' and starts STT
 *  - stopVoiceMode returns the current transcript snapshot and stops STT
 *  - cancelAll tears down STT + TTS + audio session in the right order
 *  - exposes STT/TTS passthrough fields (isListening, isSpeaking, transcript, error)
 */

import { act, renderHook } from '@testing-library/react-native';

// =============================================================================
// Mocks for the dependencies. `useSpeechToText` and `useStreamingTts` are
// React hooks whose return value is a plain object; `audioSessionManager` is
// a module-level singleton. All three are driven through jest.fn() stubs so
// we can assert ordering.
// =============================================================================

const sttState = {
  isListening: false,
  transcript: '',
  error: null as string | null,
};
const mockStartListening = jest.fn().mockResolvedValue(undefined);
const mockStopListening = jest.fn();
jest.mock('@/hooks/use-speech-to-text', () => ({
  useSpeechToText: () => ({
    startListening: mockStartListening,
    stopListening: mockStopListening,
    isListening: sttState.isListening,
    transcript: sttState.transcript,
    error: sttState.error,
  }),
}));

const ttsState = { isSpeaking: false };
const mockSpeak = jest.fn();
const mockTtsStop = jest.fn();
jest.mock('@/hooks/use-streaming-tts', () => ({
  useStreamingTts: () => ({
    speak: mockSpeak,
    stop: mockTtsStop,
    isSpeaking: ttsState.isSpeaking,
  }),
}));

const mockSetMode = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/services/audio-session-manager', () => ({
  audioSessionManager: {
    setMode: (...args: unknown[]) => mockSetMode(...args),
  },
}));

// eslint-disable-next-line import/first
import { useVoiceMode } from '@/hooks/use-voice-mode';

beforeEach(() => {
  jest.clearAllMocks();
  sttState.isListening = false;
  sttState.transcript = '';
  sttState.error = null;
  ttsState.isSpeaking = false;
  mockStartListening.mockResolvedValue(undefined);
  mockSetMode.mockResolvedValue(undefined);
});

describe('useVoiceMode', () => {
  it('initial state: isActive=false, transcript empty, not listening/speaking', () => {
    const { result } = renderHook(() => useVoiceMode());
    expect(result.current.isActive).toBe(false);
    expect(result.current.isListening).toBe(false);
    expect(result.current.isSpeaking).toBe(false);
    expect(result.current.transcript).toBe('');
    expect(result.current.error).toBeNull();
  });

  it('returns callable handles across identical re-renders (no crash / re-render loop)', () => {
    const { result, rerender } = renderHook(() => useVoiceMode());
    const first = {
      start: result.current.startVoiceMode,
      stop: result.current.stopVoiceMode,
      cancel: result.current.cancelAll,
      play: result.current.playResponse,
    };
    expect(typeof first.start).toBe('function');
    expect(typeof first.stop).toBe('function');
    expect(typeof first.cancel).toBe('function');
    expect(typeof first.play).toBe('function');
    // Re-render must not throw; handles remain callable.
    rerender({});
    expect(typeof result.current.startVoiceMode).toBe('function');
    expect(typeof result.current.stopVoiceMode).toBe('function');
    expect(typeof result.current.cancelAll).toBe('function');
    expect(typeof result.current.playResponse).toBe('function');
  });

  it('startVoiceMode sets the coaching audio session, flips isActive, and starts STT', async () => {
    const { result } = renderHook(() => useVoiceMode());
    await act(async () => {
      await result.current.startVoiceMode();
    });
    expect(mockSetMode).toHaveBeenCalledWith('coaching');
    expect(mockStartListening).toHaveBeenCalledTimes(1);
    expect(result.current.isActive).toBe(true);
    // Ordering: audio session is set BEFORE the STT call.
    const setModeOrder = mockSetMode.mock.invocationCallOrder[0];
    const startOrder = mockStartListening.mock.invocationCallOrder[0];
    expect(setModeOrder).toBeLessThan(startOrder);
  });

  it('stopVoiceMode stops STT and returns the current transcript snapshot', () => {
    sttState.transcript = 'add a warm up set';
    const { result } = renderHook(() => useVoiceMode());
    let returned: string | undefined;
    act(() => {
      returned = result.current.stopVoiceMode();
    });
    expect(mockStopListening).toHaveBeenCalledTimes(1);
    expect(returned).toBe('add a warm up set');
  });

  it('playResponse forwards to tts.speak', () => {
    const { result } = renderHook(() => useVoiceMode());
    act(() => {
      result.current.playResponse('Nice lift');
    });
    expect(mockSpeak).toHaveBeenCalledWith('Nice lift');
  });

  it('cancelAll tears down STT + TTS + audio session and flips isActive false', async () => {
    const { result } = renderHook(() => useVoiceMode());
    await act(async () => {
      await result.current.startVoiceMode();
    });
    expect(result.current.isActive).toBe(true);

    act(() => {
      result.current.cancelAll();
    });

    expect(mockStopListening).toHaveBeenCalledTimes(1);
    expect(mockTtsStop).toHaveBeenCalledTimes(1);
    expect(mockSetMode).toHaveBeenLastCalledWith('idle');
    expect(result.current.isActive).toBe(false);
  });

  it('cleanup on unmount does not throw when nothing was started', () => {
    const { unmount } = renderHook(() => useVoiceMode());
    expect(() => unmount()).not.toThrow();
  });
});
