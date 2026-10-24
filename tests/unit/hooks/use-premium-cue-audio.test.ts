/**
 * Covers usePremiumCueAudio priorityHint behavior — existing non-hint
 * callers must keep working, and numeric severity should collapse
 * minIntervalMs / volume through the shared mapper.
 */

import { renderHook, act } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { usePremiumCueAudio } from '@/features/voice/hooks/use-premium-cue-audio';
import { mapSeverityToAudioHint } from '@/lib/services/cue-priority-audio';
import { Audio } from 'expo-av';
import { audioSessionManager } from '@/lib/services/audio-session-manager';

const mockSpeak = jest.fn();
const mockStop = jest.fn();
let mockVoiceEnabled = true;
let mockSettingsLoading = false;
let mockFileExists = false;
jest.mock('../../../assets/audio/cues/cue-manifest.json', () => ({ 'asset advice': 'advice.mp3' }), { virtual: true });
jest.mock('@/features/form-tracking/hooks/use-form-tracking-settings', () => ({
  useFormTrackingSettings: () => ({ loading: mockSettingsLoading, resolve: () => ({ voiceEnabled: mockVoiceEnabled }) }),
}));
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
    this.exists = mockFileExists;
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
  InterruptionModeAndroid: { DuckOthers: 1 },
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

beforeEach(() => {
  jest.clearAllMocks();
  mockVoiceEnabled = true;
  mockSettingsLoading = false;
  mockFileExists = false;
  jest.mocked(Audio.setAudioModeAsync).mockResolvedValue(undefined);
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

describe('usePremiumCueAudio live playback safety', () => {
  it.each(['loading', 'opted-out'])('fails closed for persisted settings: %s', async (state) => {
    mockSettingsLoading = state === 'loading';
    mockVoiceEnabled = state !== 'opted-out';
    const { result } = renderHook(() => usePremiumCueAudio({ enabled: true }));
    await act(async () => { result.current.speak('No permission to speak'); });
    expect(mockSpeak).not.toHaveBeenCalled();
    expect(Audio.setAudioModeAsync).not.toHaveBeenCalled();
  });
  it('does not configure audio while opted out', async () => {
    const { unmount } = renderHook(() => usePremiumCueAudio({ enabled: false }));
    await act(async () => {});
    expect(Audio.setAudioModeAsync).not.toHaveBeenCalled();
    unmount();
  });
  it('reserves the player before async initialization so bursts cannot overlap', async () => {
    const { result } = renderHook(() => usePremiumCueAudio({ enabled: true }));
    await act(async () => {
      result.current.speak('First');
      result.current.speak('Second');
      result.current.speak('Third', { immediate: true });
    });
    expect(mockSpeak.mock.calls.map(([text]) => text)).toEqual(['First']);
  });
  it('invalidates speech awaiting audio configuration on stop', async () => {
    let finish!: () => void;
    jest.mocked(Audio.setAudioModeAsync).mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => usePremiumCueAudio({ enabled: true }));
    await act(async () => { result.current.speak('Stale'); });
    await act(async () => {
      result.current.stop();
      finish();
    });
    expect(mockSpeak).not.toHaveBeenCalled();
    jest.mocked(Audio.setAudioModeAsync).mockResolvedValue(undefined);
  });
  it('does not restart or stop speech when the telemetry callback changes', async () => {
    mockSpeak.mockImplementation(() => {});
    const { result, rerender } = renderHook(({ onEvent }: { onEvent: jest.Mock }) => usePremiumCueAudio({ enabled: true, onEvent }), {
      initialProps: { onEvent: jest.fn() },
    });
    await act(async () => { result.current.speak('First'); });
    mockStop.mockClear();
    rerender({ onEvent: jest.fn() });
    expect(mockStop).not.toHaveBeenCalled();
  });
  it('cancels on audio-manager cancellation and route changes', async () => {
    mockSpeak.mockImplementation(() => {});
    const { result } = renderHook(() => usePremiumCueAudio({ enabled: true }));
    await act(async () => { result.current.speak('First'); });
    mockStop.mockClear();
    act(() => { audioSessionManager.cancel(); });
    expect(mockStop).toHaveBeenCalledTimes(1);
    const { result: second } = renderHook(() => usePremiumCueAudio({ enabled: true }));
    await act(async () => { second.current.speak('Next'); });
    mockStop.mockClear();
    act(() => { audioSessionManager.notifyRouteChanged('bluetooth'); });
    expect(mockStop).toHaveBeenCalled();
  });
  it.each(['disable', 'unmount', 'exercise', 'mute'])('cancels active speech on %s', async (transition) => {
    mockSpeak.mockImplementation(() => {});
    const { result, rerender, unmount } = renderHook((props: { enabled: boolean; contextKey: string; volume: number }) => usePremiumCueAudio(props), {
      initialProps: { enabled: true, contextKey: 'session:pullup', volume: 1 },
    });
    await act(async () => { result.current.speak('Active'); });
    mockStop.mockClear();
    if (transition === 'unmount') unmount();
    else rerender({ enabled: transition !== 'disable', contextKey: transition === 'exercise' ? 'session:curl' : 'session:pullup', volume: transition === 'mute' ? 0 : 1 });
    expect(mockStop).toHaveBeenCalled();
  });
  it('cannot override zero user volume with high priority', async () => {
    const { result } = renderHook(() => usePremiumCueAudio({ enabled: true, volume: 0, priorityHint: 3 }));
    await act(async () => { result.current.speak('Muted'); });
    expect(mockSpeak).not.toHaveBeenCalled();
  });
  it('drops competing advice instead of draining a stale queue', async () => {
    mockSpeak.mockImplementation(() => {});
    const { result, unmount } = renderHook(() => usePremiumCueAudio({ enabled: true, minIntervalMs: 0 }));
    await act(async () => { result.current.speak('First'); });
    await act(async () => {
      result.current.speak('Outdated advice');
      mockSpeak.mock.calls[0][1].onDone();
    });
    expect(mockSpeak.mock.calls.map(([text]) => text)).toEqual(['First']);
    unmount();
  });
});

describe('usePremiumCueAudio observed coaching', () => {
  it.each(['resolution', 'confidence', 'silence'])('cancels obsolete active advice on %s', async (change) => {
    jest.useFakeTimers();
    mockSpeak.mockImplementation(() => {});
    const { result, unmount } = renderHook(() => usePremiumCueAudio({ enabled: true }));
    const candidate = { issueId: 'shoulders', message: 'Lower your shoulders.', priority: 2 as const, kind: 'form' as const };
    const send = async (elapsed: number, candidates = [candidate], trackingConfidence = 0.9) => {
      await act(async () => {
        jest.advanceTimersByTime(elapsed);
        result.current.observe({ contextKey: 'session:pullup', sampleId: Date.now(), trackingConfidence, atRepBoundary: true, candidates });
      });
    };
    await send(0); await send(500); await send(500); await send(500);
    expect(mockSpeak).toHaveBeenCalledTimes(1);
    mockStop.mockClear();
    if (change === 'resolution') await send(500, []);
    else if (change === 'confidence') await send(500, [candidate], 0.3);
    else await act(async () => { jest.advanceTimersByTime(1000); });
    expect(mockStop).toHaveBeenCalled();
    unmount();
    jest.useRealTimers();
  });

  it('requires sustained fresh high-confidence observations before coaching', async () => {
    jest.useFakeTimers();
    const { result, unmount } = renderHook(() => usePremiumCueAudio({ enabled: true }));
    const observe = async (elapsed: number, confidence = 0.9) => {
      await act(async () => {
        jest.advanceTimersByTime(elapsed);
        result.current.observe({
          contextKey: 'session:pullup', sampleId: Date.now(), trackingConfidence: confidence,
          atRepBoundary: true,
          candidates: [{ issueId: 'shoulders', message: 'Lower your shoulders away from your ears.', priority: 2, kind: 'form' }],
        });
      });
    };
    await observe(0, 0.4);
    await observe(500);
    await observe(500);
    expect(mockSpeak).not.toHaveBeenCalled();
    await observe(500);
    await observe(500);
    expect(mockSpeak).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 30; index += 1) await observe(500);
    expect(mockSpeak).toHaveBeenCalledTimes(1);
    unmount();
    jest.useRealTimers();
  });
});

describe('usePremiumCueAudio evidence ownership', () => {
  const candidate = { issueId: 'shoulders', message: 'Lower your shoulders.', priority: 2 as const, kind: 'form' as const };
  const observation = (overrides = {}) => ({
    contextKey: 'session:pullup', sampleId: Date.now(), trackingConfidence: 0.9,
    atRepBoundary: true, candidates: [candidate], ...overrides,
  });
  const sustain = async (observe: ReturnType<typeof usePremiumCueAudio>['observe']) => {
    for (const elapsed of [0, 500, 500, 500]) await act(async () => {
      jest.advanceTimersByTime(elapsed);
      observe(observation());
    });
  };
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it.each(['resolution', 'confidence', 'silence', 'phase'])('invalidates pending setup on %s', async (change) => {
    let finish!: () => void;
    jest.mocked(Audio.setAudioModeAsync).mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { result, unmount } = renderHook(() => usePremiumCueAudio({ enabled: true }));
    await sustain(result.current.observe);
    await act(async () => {
      jest.advanceTimersByTime(change === 'silence' ? 751 : 500);
      if (change !== 'silence') result.current.observe(observation({
        candidates: change === 'resolution' ? [] : [candidate],
        trackingConfidence: change === 'confidence' ? 0.3 : 0.9,
        atRepBoundary: change !== 'phase',
      }));
      finish();
    });
    expect(mockSpeak).not.toHaveBeenCalled();
    unmount();
  });

  it('renews active advice only with fresh samples, not duplicate frames', async () => {
    mockSpeak.mockImplementation(() => {});
    const { result, unmount } = renderHook(() => usePremiumCueAudio({ enabled: true }));
    await sustain(result.current.observe);
    let fresh = observation();
    await act(async () => {
      jest.advanceTimersByTime(500);
      fresh = observation();
      result.current.observe(fresh);
      jest.advanceTimersByTime(500);
      result.current.observe(fresh);
    });
    expect(mockStop).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(251); });
    expect(mockStop).toHaveBeenCalledTimes(1);
    await act(async () => { jest.advanceTimersByTime(8000); });
    await sustain(result.current.observe);
    expect(mockSpeak).toHaveBeenCalledTimes(1); // Expiry never rearms the issue.
    unmount();
  });

  it('ignores samples belonging to a different configured context', async () => {
    const { result, unmount } = renderHook(() => usePremiumCueAudio({ enabled: true, contextKey: 'session:curl' }));
    await sustain(result.current.observe);
    expect(mockSpeak).not.toHaveBeenCalled();
    unmount();
  });

  it('late asset failure cannot detach a newer sound from cancellation', async () => {
    // Native asset ownership must survive late rejection from a cancelled play.
    mockFileExists = true;
    let rejectOld!: (error: Error) => void;
    const oldSound = {
      setOnPlaybackStatusUpdate: jest.fn(), unloadAsync: jest.fn().mockResolvedValue(undefined),
      playAsync: jest.fn(() => new Promise((_resolve, reject) => { rejectOld = reject; })),
    };
    const newSound = {
      setOnPlaybackStatusUpdate: jest.fn(), unloadAsync: jest.fn().mockResolvedValue(undefined),
      playAsync: jest.fn().mockResolvedValue(undefined),
    };
    jest.mocked(Audio.Sound.createAsync)
      .mockResolvedValueOnce({ sound: oldSound } as unknown as Awaited<ReturnType<typeof Audio.Sound.createAsync>>)
      .mockResolvedValueOnce({ sound: newSound } as unknown as Awaited<ReturnType<typeof Audio.Sound.createAsync>>);
    const { result, unmount } = renderHook(() => usePremiumCueAudio({ enabled: true }));
    await act(async () => { result.current.speak('Asset advice'); });
    await act(async () => { result.current.stop(); jest.advanceTimersByTime(8000); });
    await act(async () => { result.current.speak('Asset advice'); });
    expect(newSound.playAsync).toHaveBeenCalledTimes(1);
    await act(async () => { rejectOld(new Error('Late native rejection')); });
    expect(newSound.unloadAsync).not.toHaveBeenCalled();
    await act(async () => { result.current.stop(); });
    expect(newSound.unloadAsync).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('background cancellation prevents pending setup from speaking after foregrounding', async () => {
    const listener = jest.mocked(AppState.addEventListener);
    let finish!: () => void;
    jest.mocked(Audio.setAudioModeAsync).mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { result, unmount } = renderHook(() => usePremiumCueAudio({ enabled: true }));
    await sustain(result.current.observe);
    const change = listener.mock.calls[listener.mock.calls.length - 1][1];
    await act(async () => { change('background'); change('active'); finish(); });
    expect(mockSpeak).not.toHaveBeenCalled();
    unmount();
  });

  it('expired observation callbacks cannot stop or unlock newer explicit speech', async () => {
    mockSpeak.mockImplementation(() => {});
    const { result, unmount } = renderHook(() => usePremiumCueAudio({ enabled: true }));
    await sustain(result.current.observe);
    const oldCallbacks = mockSpeak.mock.calls[0][1];
    await act(async () => { jest.advanceTimersByTime(8000); });
    await act(async () => { result.current.speak('New explicit advice'); });
    mockStop.mockClear();
    await act(async () => {
      oldCallbacks.onDone(); oldCallbacks.onStopped();
      jest.advanceTimersByTime(8000);
    });
    await act(async () => { result.current.speak('Must still be busy'); });
    expect(mockSpeak.mock.calls.map(([text]) => text)).toEqual([candidate.message, 'New explicit advice']);
    expect(mockStop).not.toHaveBeenCalled();
    unmount();
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
