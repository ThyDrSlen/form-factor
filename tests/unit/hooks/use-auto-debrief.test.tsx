/**
 * Tests for useAutoDebrief.
 *
 * Mocks:
 *   - @/lib/services/coach-auto-debrief.generateAutoDebrief + getCachedAutoDebrief
 *   - @/lib/stores/session-runner.onSessionFinished (simulate fanout)
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockGenerate = jest.fn();
const mockGetCached = jest.fn();
const mockIsEnabled = jest.fn();

jest.mock('@/lib/services/coach-auto-debrief', () => ({
  generateAutoDebrief: (...args: unknown[]) => mockGenerate(...args),
  getCachedAutoDebrief: (...args: unknown[]) => mockGetCached(...args),
  isAutoDebriefEnabled: () => mockIsEnabled(),
}));

// Simulated session-finished listener: our mock holds refs to all
// subscribed mockListeners and exposes a helper to trigger them.
const mockListeners = new Set<(ev: { sessionId: string; startedAt: string; endedAt: string; goalProfile: string; name: string | null }) => void | Promise<void>>();
function triggerFinished(
  event: { sessionId: string; startedAt: string; endedAt: string; goalProfile: string; name: string | null },
) {
  return Promise.all(Array.from(mockListeners).map((fn) => fn(event)));
}

jest.mock('@/lib/stores/session-runner', () => ({
  onSessionFinished: (listener: (ev: unknown) => void) => {
    mockListeners.add(listener as never);
    return () => {
      mockListeners.delete(listener as never);
    };
  },
}));

import {
  AUTO_DEBRIEF_TIMEOUT_MESSAGE,
  useAutoDebrief,
  type UseAutoDebriefState,
} from '@/hooks/use-auto-debrief';

function makeEvent() {
  return {
    sessionId: 'sess-1',
    startedAt: '2026-04-16T10:00:00.000Z',
    endedAt: '2026-04-16T11:00:00.000Z',
    goalProfile: 'hypertrophy',
    name: null,
  };
}

function makeAnalytics() {
  return {
    sessionId: 'sess-1',
    exerciseName: 'Back Squat',
    repCount: 5,
    avgFqi: 0.8,
    fqiTrendSlope: 0.01,
    topFault: null,
    maxSymmetryPct: null,
    tempoTrendSlope: null,
    reps: [],
  };
}

describe('useAutoDebrief', () => {
  beforeEach(() => {
    mockListeners.clear();
    mockGenerate.mockReset();
    mockGetCached.mockReset();
    mockIsEnabled.mockReset();
    mockIsEnabled.mockReturnValue(true);
  });

  it('starts idle and does nothing without a finished session', () => {
    const { result } = renderHook(() =>
      useAutoDebrief({ buildInput: () => null }),
    );

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('fetches + surfaces data when a session finishes', async () => {
    mockGenerate.mockResolvedValue({
      sessionId: 'sess-1',
      provider: 'openai',
      brief: 'Great set of squats.',
      generatedAt: 'now',
    });

    const { result } = renderHook(() =>
      useAutoDebrief({
        buildInput: () => ({ sessionId: 'sess-1', analytics: makeAnalytics() }),
      }),
    );

    await act(async () => {
      await triggerFinished(makeEvent());
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.data?.brief).toBe('Great set of squats.');
    expect(result.current.error).toBeNull();
  });

  it('sets loading true during the generate call', async () => {
    let resolveGenerate: (v: unknown) => void = () => {};
    mockGenerate.mockImplementation(
      () => new Promise((r) => {
        resolveGenerate = r;
      }),
    );

    const { result } = renderHook(() =>
      useAutoDebrief({
        buildInput: () => ({ sessionId: 'sess-1', analytics: makeAnalytics() }),
      }),
    );

    // Fire without awaiting — the listener awaits generate, which is pinned
    // open for this test so we can observe the in-flight loading state.
    let triggerPromise: Promise<unknown> | null = null;
    act(() => {
      triggerPromise = triggerFinished(makeEvent());
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(true);
    });

    await act(async () => {
      resolveGenerate({ sessionId: 'sess-1', provider: 'openai', brief: 'OK', generatedAt: 'now' });
      // Let the listener's awaited runWith() settle so cleanup can run.
      await triggerPromise;
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('captures generateAutoDebrief errors without crashing', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockGenerate.mockRejectedValue(new Error('coach offline'));

    const { result } = renderHook(() =>
      useAutoDebrief({
        buildInput: () => ({ sessionId: 'sess-1', analytics: makeAnalytics() }),
      }),
    );

    await act(async () => {
      await triggerFinished(makeEvent());
    });

    await waitFor(() => {
      expect(result.current.error).toBe('coach offline');
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.data).toBeNull();
  });

  it('retry replays the last input on demand', async () => {
    mockGenerate
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({
        sessionId: 'sess-1',
        provider: 'openai',
        brief: 'second try works',
        generatedAt: 'now',
      });
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() =>
      useAutoDebrief({
        buildInput: () => ({ sessionId: 'sess-1', analytics: makeAnalytics() }),
      }),
    );

    await act(async () => {
      await triggerFinished(makeEvent());
    });
    await waitFor(() => expect(result.current.error).toBe('timeout'));

    await act(async () => {
      await result.current.retry();
    });

    await waitFor(() => expect(result.current.data?.brief).toBe('second try works'));
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });

  it('skips work when buildInput returns null', async () => {
    const { result } = renderHook(() =>
      useAutoDebrief({ buildInput: () => null }),
    );

    await act(async () => {
      await triggerFinished(makeEvent());
    });

    expect(mockGenerate).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
  });

  it('preloads cached debrief when sessionId is provided', async () => {
    mockGetCached.mockResolvedValue({
      sessionId: 'sess-1',
      provider: 'openai',
      brief: 'cached from disk',
      generatedAt: 'now',
    });

    const { result } = renderHook(() =>
      useAutoDebrief({
        sessionId: 'sess-1',
        buildInput: () => null,
      }),
    );

    await waitFor(() => {
      expect(result.current.data?.brief).toBe('cached from disk');
    });
    expect(mockGetCached).toHaveBeenCalledWith('sess-1');
  });

  it('is inert when feature is disabled', async () => {
    mockIsEnabled.mockReturnValue(false);

    const { result } = renderHook(() =>
      useAutoDebrief({
        buildInput: () => ({ sessionId: 'sess-1', analytics: makeAnalytics() }),
      }),
    );

    await act(async () => {
      await triggerFinished(makeEvent());
    });

    expect(mockGenerate).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
  });

  it('surfaces a timeout error when generate hangs past the budget', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    // generate resolves never — we want the timeout race to win.
    mockGenerate.mockImplementation(() => new Promise<never>(() => {}));

    const { result } = renderHook(() =>
      useAutoDebrief({
        buildInput: () => ({ sessionId: 'sess-1', analytics: makeAnalytics() }),
      }),
    );

    await act(async () => {
      await triggerFinished(makeEvent());
    });

    // The hook's timeout is 8s. Real timers keep the test contained to a
    // single file and avoid polluting neighbouring tests with fake-timers.
    await waitFor(
      () => {
        expect(result.current.error).toBe(AUTO_DEBRIEF_TIMEOUT_MESSAGE);
        expect(result.current.loading).toBe(false);
      },
      { timeout: 9000, interval: 100 },
    );
  }, 12000);

  it('surfaces errors from buildInput', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() =>
      useAutoDebrief({
        buildInput: () => {
          throw new Error('no analytics available');
        },
      }),
    );

    await act(async () => {
      await triggerFinished(makeEvent());
    });

    await waitFor(() => {
      expect(result.current.error).toBe('no analytics available');
    });
  });

  // ---------------------------------------------------------------------------
  // initialInput on-mount leg (#575 item #5)
  // ---------------------------------------------------------------------------
  describe('initialInput', () => {
    it('fires generateAutoDebrief once on mount when initialInput provided', async () => {
      mockGenerate.mockResolvedValue({
        sessionId: 'sess-recap',
        provider: 'openai',
        brief: 'Recap generated.',
        generatedAt: 'now',
      });

      const { result } = renderHook(() =>
        useAutoDebrief({
          buildInput: () => null,
          initialInput: {
            sessionId: 'sess-recap',
            analytics: { ...makeAnalytics(), sessionId: 'sess-recap' },
          },
        }),
      );

      await waitFor(() => {
        expect(result.current.data?.sessionId).toBe('sess-recap');
      });
      expect(mockGenerate).toHaveBeenCalledTimes(1);
    });

    it('does not fire when initialInput is null', async () => {
      renderHook(() =>
        useAutoDebrief({
          buildInput: () => null,
          initialInput: null,
        }),
      );
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('does not fire when auto-debrief feature flag is off', async () => {
      mockIsEnabled.mockReturnValue(false);
      renderHook(() =>
        useAutoDebrief({
          buildInput: () => null,
          initialInput: {
            sessionId: 'sess-recap',
            analytics: makeAnalytics(),
          },
        }),
      );
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('fires exactly once per mount even when prop identity changes', async () => {
      mockGenerate.mockResolvedValue({
        sessionId: 'sess-recap',
        provider: 'openai',
        brief: 'Done.',
        generatedAt: 'now',
      });

      const initial = {
        sessionId: 'sess-recap',
        analytics: { ...makeAnalytics(), sessionId: 'sess-recap' },
      };
      type Props = { input: typeof initial | null };
      const { rerender } = renderHook<UseAutoDebriefState, Props>(
        ({ input }) =>
          useAutoDebrief({
            buildInput: () => null,
            initialInput: input,
          }),
        { initialProps: { input: initial } },
      );

      await act(async () => {
        await Promise.resolve();
      });

      // Force re-render with a different input reference — the guard should
      // ignore the second value since we only want a single on-mount run.
      rerender({
        input: {
          sessionId: 'sess-recap-2',
          analytics: { ...makeAnalytics(), sessionId: 'sess-recap-2' },
        },
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(mockGenerate).toHaveBeenCalledTimes(1);
    });
  });
});
