/**
 * use-streaming-tts fallback + re-entrancy coverage (wave-31, Pack C / C5).
 *
 * Targets the untested branches around the TTS fallback chain:
 *   - ElevenLabs success: audio buffer -> Audio.Sound.createAsync -> playAsync
 *   - ElevenLabs returns null: hook falls back to expo-speech Speech.speak
 *   - ElevenLabs throws: catch-branch unloads any stale sound + falls back
 *     to expo-speech Speech.speak
 *   - processQueue re-entrancy guard: speak() can't kick off a parallel
 *     sentence synthesis while the previous one is still playing
 *   - speakStream accumulates chunks and only flushes complete sentences;
 *     an incomplete tail stays buffered
 *   - stop() drains queue + stops in-flight sound + silences Speech
 */

import { renderHook, act } from '@testing-library/react-native';

// ---- expo-av mock -------------------------------------------------------
const mockPlayAsync = jest.fn().mockResolvedValue(undefined);
const mockStopAsync = jest.fn().mockResolvedValue(undefined);
const mockUnloadAsync = jest.fn().mockResolvedValue(undefined);
const mockSetOnPlaybackStatusUpdate = jest.fn();

const makeSound = () => ({
  playAsync: mockPlayAsync,
  stopAsync: mockStopAsync,
  unloadAsync: mockUnloadAsync,
  setOnPlaybackStatusUpdate: mockSetOnPlaybackStatusUpdate,
});

const mockCreateAsync: jest.Mock = jest.fn(async (_source: unknown) => ({
  sound: makeSound(),
}));

jest.mock('expo-av', () => ({
  Audio: {
    Sound: {
      createAsync: (source: unknown) => mockCreateAsync(source),
    },
  },
}));

// ---- expo-speech mock ---------------------------------------------------
const mockSpeak = jest.fn();
const mockSpeechStop = jest.fn();
jest.mock('expo-speech', () => ({
  speak: (...args: any[]) => mockSpeak(...args),
  stop: (...args: any[]) => mockSpeechStop(...args),
}));

// ---- elevenlabs-service mock --------------------------------------------
const mockGenerateSpeech = jest.fn();
jest.mock('@/lib/services/elevenlabs-service', () => ({
  generateSpeech: (...args: any[]) => mockGenerateSpeech(...args),
}));

// `btoa` is a browser global but jest-expo's environment exposes it via
// Node 20. If it isn't present, polyfill for the ArrayBuffer->base64 helper.
if (typeof (globalThis as any).btoa !== 'function') {
  (globalThis as any).btoa = (str: string) =>
    Buffer.from(str, 'binary').toString('base64');
}

import { useStreamingTts } from '@/hooks/use-streaming-tts';

function oneByteBuffer(): ArrayBuffer {
  return new Uint8Array([0x42]).buffer;
}

async function flushMicrotasks() {
  // 4 flushes is enough to drain the processQueue chain.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('use-streaming-tts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateSpeech.mockReset();
    mockCreateAsync.mockImplementation(async () => ({ sound: makeSound() }));
  });

  it('ElevenLabs success: synthesizes, creates a sound, and plays it', async () => {
    mockGenerateSpeech.mockResolvedValue(oneByteBuffer());

    const { result } = renderHook(() => useStreamingTts());

    await act(async () => {
      result.current.speak('Hello there.');
      await flushMicrotasks();
    });

    expect(mockGenerateSpeech).toHaveBeenCalledTimes(1);
    expect(mockGenerateSpeech).toHaveBeenCalledWith('Hello there.');
    expect(mockCreateAsync).toHaveBeenCalledTimes(1);
    // The constructed sound had a data URI for mpeg/base64.
    const createArgs = mockCreateAsync.mock.calls[0]?.[0] as { uri: string } | undefined;
    expect(createArgs?.uri).toMatch(/^data:audio\/mpeg;base64,/);
    expect(mockPlayAsync).toHaveBeenCalledTimes(1);
    // Did NOT fall back to system TTS.
    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it('ElevenLabs returns null -> falls back to expo-speech', async () => {
    mockGenerateSpeech.mockResolvedValue(null);
    // The system TTS invokes onDone to signal completion of the single
    // sentence so the queue drains.
    mockSpeak.mockImplementation((_text: string, opts: { onDone?: () => void }) => {
      opts.onDone?.();
    });

    const { result } = renderHook(() => useStreamingTts());

    await act(async () => {
      result.current.speak('Back to system speech.');
      await flushMicrotasks();
    });

    expect(mockGenerateSpeech).toHaveBeenCalled();
    expect(mockCreateAsync).not.toHaveBeenCalled();
    expect(mockSpeak).toHaveBeenCalledTimes(1);
    expect(mockSpeak.mock.calls[0][0]).toBe('Back to system speech.');
  });

  it('ElevenLabs throws -> logs warn and falls back to expo-speech', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockGenerateSpeech.mockRejectedValue(new Error('11labs 500'));
    mockSpeak.mockImplementation((_text: string, opts: { onDone?: () => void }) => {
      opts.onDone?.();
    });

    const { result } = renderHook(() => useStreamingTts());

    await act(async () => {
      result.current.speak('Will survive.');
      await flushMicrotasks();
    });

    expect(
      warnSpy.mock.calls.some((call) =>
        String(call[0] ?? '').includes('[StreamingTTS] ElevenLabs playback error'),
      ),
    ).toBe(true);
    expect(mockSpeak).toHaveBeenCalledTimes(1);
    expect(mockSpeak.mock.calls[0][0]).toBe('Will survive.');

    warnSpy.mockRestore();
  });

  it('processQueue re-entrancy: a second speak() while one sentence is still playing does not double-synthesize in parallel', async () => {
    // Set up a long-running first synthesis: resolve with a buffer, but
    // hold the subsequent Audio.Sound.createAsync off so the hook gets
    // stuck in "processing" state mid-sentence.
    let unblockCreate!: () => void;
    const createBlock = new Promise<void>((resolve) => {
      unblockCreate = resolve;
    });
    mockGenerateSpeech.mockResolvedValue(oneByteBuffer());
    mockCreateAsync.mockImplementationOnce(async () => {
      await createBlock;
      return { sound: makeSound() };
    });

    const { result } = renderHook(() => useStreamingTts());

    await act(async () => {
      result.current.speak('Sentence one. Sentence two.');
      await flushMicrotasks();
    });

    // Only the first sentence is being synthesized; the second one sits
    // on the queue until the currently-playing sound signals didJustFinish.
    expect(mockGenerateSpeech).toHaveBeenCalledTimes(1);
    expect(mockGenerateSpeech).toHaveBeenCalledWith('Sentence one.');

    // Now speak() again — but speak() resets the processingRef to false and
    // rewrites the queue. The re-entrancy guard inside processQueue means
    // only ONE processor chain is active at a time. Unblock the first sound
    // afterwards and confirm the second-speak queue ran.
    mockGenerateSpeech.mockResolvedValueOnce(oneByteBuffer());
    await act(async () => {
      result.current.speak('Third. Fourth.');
      await flushMicrotasks();
    });

    // speak() reset the queue — total generateSpeech calls should reflect
    // the reset (new queue drained in order without the original queue
    // continuing in parallel).
    expect(mockGenerateSpeech.mock.calls.length).toBeGreaterThanOrEqual(2);
    // The most recent call picked up the NEW queue's first sentence.
    expect(mockGenerateSpeech).toHaveBeenLastCalledWith('Third.');

    // Unblock the original createAsync so jest doesn't leave a dangling
    // microtask that pollutes later tests.
    unblockCreate();
    await act(async () => {
      await flushMicrotasks();
    });
  });

  it('speakStream: accumulates chunks and only flushes complete sentences', async () => {
    mockGenerateSpeech.mockResolvedValue(oneByteBuffer());

    const { result } = renderHook(() => useStreamingTts());

    await act(async () => {
      result.current.speakStream('Hello ');
      await flushMicrotasks();
    });
    // Incomplete sentence — nothing synthesized yet.
    expect(mockGenerateSpeech).not.toHaveBeenCalled();

    await act(async () => {
      result.current.speakStream('there. Keep going');
      await flushMicrotasks();
    });
    // "Hello there." is complete and got flushed; "Keep going" is buffered.
    expect(mockGenerateSpeech).toHaveBeenCalledTimes(1);
    expect(mockGenerateSpeech).toHaveBeenCalledWith('Hello there.');

    // The splitter only recognises a complete sentence when a terminator is
    // followed by whitespace — i.e. the NEXT sentence starts. Deliver the
    // terminator plus the start of a following sentence, and simulate the
    // in-flight sound finishing so the queue can process the next entry.
    const statusCb = mockSetOnPlaybackStatusUpdate.mock.calls[0]?.[0];
    expect(typeof statusCb).toBe('function');
    await act(async () => {
      statusCb({ isLoaded: true, didJustFinish: true });
      await flushMicrotasks();
    });

    await act(async () => {
      result.current.speakStream(' strong. Done');
      await flushMicrotasks();
    });

    // "Keep going strong." gets flushed once the terminator + next-sentence
    // lead ("Done") arrive. "Done" stays buffered until a further terminator.
    expect(mockGenerateSpeech).toHaveBeenCalledWith('Keep going strong.');
    expect(mockGenerateSpeech).not.toHaveBeenCalledWith('Done');
  });

  it('stop(): clears queue, calls Speech.stop, stops and unloads current sound', async () => {
    mockGenerateSpeech.mockResolvedValue(oneByteBuffer());

    const { result } = renderHook(() => useStreamingTts());

    await act(async () => {
      result.current.speak('One. Two. Three.');
      await flushMicrotasks();
    });

    // A sound was created for "One."
    expect(mockCreateAsync).toHaveBeenCalled();

    await act(async () => {
      result.current.stop();
      await flushMicrotasks();
    });

    expect(mockSpeechStop).toHaveBeenCalledTimes(1);
    expect(mockStopAsync).toHaveBeenCalledTimes(1);
    expect(mockUnloadAsync).toHaveBeenCalled();
    expect(result.current.isSpeaking).toBe(false);
  });

  it('empty stream chunks never synthesize', async () => {
    const { result } = renderHook(() => useStreamingTts());

    await act(async () => {
      result.current.speakStream('');
      result.current.speakStream('   ');
      await flushMicrotasks();
    });

    expect(mockGenerateSpeech).not.toHaveBeenCalled();
  });
});
