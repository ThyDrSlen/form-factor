/**
 * Covers usePremiumCueAudio priorityHint behavior — existing non-hint
 * callers must keep working, and numeric severity should collapse
 * minIntervalMs / volume through the shared mapper.
 */

const mockSpeak = jest.fn();
const mockStop = jest.fn();
jest.mock('expo-speech', () => ({
  speak: (...args: unknown[]) => mockSpeak(...args),
  stop: (...args: unknown[]) => mockStop(...args),
}));

jest.mock('expo-file-system', () => ({
  Paths: { document: '/tmp/doc' },
  File: function (this: unknown, dir: string, path: string) {
    // @ts-expect-error - constructor
    this.uri = `file://${dir}/${path}`;
    // @ts-expect-error - constructor
    this.exists = false;
  },
}));

jest.mock('expo-av', () => ({
  Audio: {
    setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
    Sound: {
      createAsync: jest.fn().mockResolvedValue({ sound: {} }),
    },
  },
  InterruptionModeIOS: { MixWithOthers: 0 },
}));

jest.mock('@/lib/logger', () => ({
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
  logWithTs: jest.fn(),
}));

jest.mock('@/lib/services/ErrorHandler', () => ({
  createError: jest.fn(),
  logError: jest.fn(),
}));

import { renderHook, act } from '@testing-library/react-native';
import { usePremiumCueAudio } from '@/hooks/use-premium-cue-audio';
import { mapSeverityToAudioHint } from '@/lib/services/cue-priority-audio';

beforeEach(() => {
  jest.clearAllMocks();
  mockSpeak.mockImplementation((_text, opts?: { onDone?: () => void }) => {
    opts?.onDone?.();
  });
});

describe('usePremiumCueAudio (existing behavior)', () => {
  it('speaks a cue through expo-speech when enabled and no manifest match', async () => {
    const { result } = renderHook(() => usePremiumCueAudio({ enabled: true }));
    await act(async () => {
      result.current.speak('Pull higher');
    });
    expect(mockSpeak).toHaveBeenCalled();
    const opts = mockSpeak.mock.calls[0][1];
    expect(opts.volume).toBeCloseTo(1, 2); // default
  });

  it('drops cues when disabled', async () => {
    const onEvent = jest.fn();
    const { result } = renderHook(() => usePremiumCueAudio({ enabled: false, onEvent }));
    await act(async () => {
      result.current.speak('Pull higher');
    });
    expect(mockSpeak).not.toHaveBeenCalled();
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'dropped' }));
  });
});

describe('usePremiumCueAudio priorityHint (new)', () => {
  it('applies severity-derived volume when priorityHint is a number', async () => {
    const expected = mapSeverityToAudioHint(3);
    const { result } = renderHook(() => usePremiumCueAudio({ enabled: true, priorityHint: 3 }));
    await act(async () => {
      result.current.speak('Rounded back');
    });
    expect(mockSpeak).toHaveBeenCalled();
    const opts = mockSpeak.mock.calls[0][1];
    expect(opts.volume).toBeCloseTo(expected.volume, 2);
  });

  it('respects explicit priorityHint object overrides', async () => {
    const { result } = renderHook(() =>
      usePremiumCueAudio({
        enabled: true,
        priorityHint: { intervalMs: 500, volume: 0.42 },
      }),
    );
    await act(async () => {
      result.current.speak('Hip sag');
    });
    const opts = mockSpeak.mock.calls[0][1];
    expect(opts.volume).toBeCloseTo(0.42, 2);
  });

  it('falls back to raw props when priorityHint is omitted', async () => {
    const { result } = renderHook(() =>
      usePremiumCueAudio({ enabled: true, volume: 0.55, minIntervalMs: 1234 }),
    );
    await act(async () => {
      result.current.speak('Stay tight');
    });
    const opts = mockSpeak.mock.calls[0][1];
    expect(opts.volume).toBeCloseTo(0.55, 2);
  });
});
