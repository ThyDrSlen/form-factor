/**
 * Unit tests for useSessionAutopause.
 */

import { renderHook, act, waitFor } from '@testing-library/react-native';

const mockPause = jest.fn().mockResolvedValue(undefined);
const mockResume = jest.fn().mockResolvedValue(5000);
const mockPauseState = {
  isPaused: false,
  pausedAt: null as string | null,
  reason: null as string | null,
};

jest.mock('@/lib/stores/session-runner.pause', () => ({
  pauseActiveSession: (...args: unknown[]) => mockPause(...args),
  resumeActiveSession: (...args: unknown[]) => mockResume(...args),
  useSessionPauseState: () => mockPauseState,
}));

const mockSessionSelectorState: { current: { activeSession: { id: string } | null } } = {
  current: { activeSession: { id: 'sess-1' } },
};
jest.mock('@/lib/stores/session-runner', () => {
  const fn = (selector: (s: typeof mockSessionSelectorState.current) => unknown) =>
    selector(mockSessionSelectorState.current);
  (fn as unknown as { getState: () => typeof mockSessionSelectorState.current }).getState =
    () => mockSessionSelectorState.current;
  return { useSessionRunner: fn };
});

type Listener = (state: string) => void;
let appStateListeners: Listener[] = [];
const mockAddEventListener = jest.fn((event: string, listener: Listener) => {
  if (event === 'change') appStateListeners.push(listener);
  return {
    remove: () => {
      appStateListeners = appStateListeners.filter((l) => l !== listener);
    },
  };
});
jest.mock('react-native', () => ({
  AppState: {
    addEventListener: (...args: unknown[]) =>
      mockAddEventListener(...(args as [string, Listener])),
  },
}));

import { useSessionAutopause } from '@/hooks/use-session-autopause';

beforeEach(() => {
  jest.clearAllMocks();
  mockPauseState.isPaused = false;
  mockPauseState.reason = null;
  mockSessionSelectorState.current = { activeSession: { id: 'sess-1' } };
  appStateListeners = [];
});

describe('useSessionAutopause', () => {
  it('calls pauseActiveSession on background transition when a session is active', async () => {
    renderHook(() => useSessionAutopause());
    expect(appStateListeners).toHaveLength(1);

    await act(async () => {
      appStateListeners[0]('background');
    });
    expect(mockPause).toHaveBeenCalledWith('background');
  });

  it('does not pause when the app was already inactive (no active→background)', async () => {
    renderHook(() => useSessionAutopause());
    await act(async () => {
      appStateListeners[0]('inactive');
      appStateListeners[0]('background');
    });
    expect(mockPause).not.toHaveBeenCalled();
  });

  it('sets needsResume=true on return to foreground after background', async () => {
    const { result } = renderHook(() => useSessionAutopause());
    await act(async () => {
      appStateListeners[0]('background');
    });
    mockPauseState.isPaused = true;
    await act(async () => {
      appStateListeners[0]('active');
    });
    await waitFor(() => expect(result.current.needsResume).toBe(true));
  });

  it('acknowledgeResume calls resumeActiveSession and clears the banner', async () => {
    const { result } = renderHook(() => useSessionAutopause());
    await act(async () => {
      appStateListeners[0]('background');
    });
    mockPauseState.isPaused = true;
    await act(async () => {
      appStateListeners[0]('active');
    });
    await waitFor(() => expect(result.current.needsResume).toBe(true));

    let returned: number | undefined;
    await act(async () => {
      returned = await result.current.acknowledgeResume();
    });
    expect(mockResume).toHaveBeenCalled();
    expect(returned).toBe(5000);
    expect(result.current.needsResume).toBe(false);
    expect(result.current.lastPausedDurationMs).toBe(5000);
  });

  it('does nothing when enabled is false', async () => {
    renderHook(() => useSessionAutopause({ enabled: false }));
    expect(appStateListeners).toHaveLength(0);
  });

  it('clears banner when active session goes null', async () => {
    const { result, rerender } = renderHook(() => useSessionAutopause());
    await act(async () => {
      appStateListeners[0]('background');
    });
    mockPauseState.isPaused = true;
    await act(async () => {
      appStateListeners[0]('active');
    });
    await waitFor(() => expect(result.current.needsResume).toBe(true));

    // Session ends
    mockSessionSelectorState.current = { activeSession: null };
    rerender({});
    await waitFor(() => expect(result.current.needsResume).toBe(false));
  });

  it('unregisters the AppState listener on unmount (effect cleanup fires)', () => {
    const { unmount } = renderHook(() => useSessionAutopause());
    expect(appStateListeners).toHaveLength(1);

    unmount();

    expect(appStateListeners).toHaveLength(0);
  });

  it('exposes pauseReason from the underlying pause store', () => {
    mockPauseState.reason = 'background';
    const { result } = renderHook(() => useSessionAutopause());
    expect(result.current.pauseReason).toBe('background');
  });

  it('does not attempt to pause when the app backgrounds without an active session', async () => {
    mockSessionSelectorState.current = { activeSession: null };
    renderHook(() => useSessionAutopause());
    await act(async () => {
      appStateListeners[0]('background');
    });
    expect(mockPause).not.toHaveBeenCalled();
  });

  it('disabling mid-lifecycle removes the listener', () => {
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useSessionAutopause({ enabled }),
      { initialProps: { enabled: true } },
    );
    expect(appStateListeners).toHaveLength(1);

    rerender({ enabled: false });
    expect(appStateListeners).toHaveLength(0);
  });
});
