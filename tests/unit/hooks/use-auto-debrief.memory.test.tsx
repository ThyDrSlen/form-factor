/**
 * Pipeline-v2: tests the cross-session memory cache-on-success wiring in
 * useAutoDebrief. After a successful debrief and with the master flag on,
 * `cacheSessionBrief` is invoked with the session signals.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockGenerate = jest.fn();
const mockGetCached = jest.fn();
const mockIsEnabled = jest.fn();
const mockCacheBrief = jest.fn();

jest.mock('@/lib/services/coach-auto-debrief', () => ({
  generateAutoDebrief: (...args: unknown[]) => mockGenerate(...args),
  getCachedAutoDebrief: (...args: unknown[]) => mockGetCached(...args),
  isAutoDebriefEnabled: () => mockIsEnabled(),
}));

jest.mock('@/lib/services/coach-memory', () => ({
  cacheSessionBrief: (...args: unknown[]) => mockCacheBrief(...args),
}));

const mockListeners = new Set<(ev: unknown) => void | Promise<void>>();
function triggerFinished(event: unknown) {
  return Promise.all(Array.from(mockListeners).map((fn) => fn(event)));
}

jest.mock('@/lib/stores/session-runner', () => ({
  onSessionFinished: (listener: (ev: unknown) => void) => {
    mockListeners.add(listener);
    return () => {
      mockListeners.delete(listener);
    };
  },
}));

import { useAutoDebrief } from '@/hooks/use-auto-debrief';

const FLAG = 'EXPO_PUBLIC_COACH_PIPELINE_V2';
const originalFlag = process.env[FLAG];

function makeEvent() {
  return {
    sessionId: 'sess-42',
    startedAt: '2026-04-16T10:00:00.000Z',
    endedAt: '2026-04-16T11:00:00.000Z',
    goalProfile: 'hypertrophy',
    name: null,
  };
}

function makeInput() {
  return {
    sessionId: 'sess-42',
    analytics: {
      sessionId: 'sess-42',
      exerciseName: 'Back Squat',
      repCount: 5,
      avgFqi: 0.82,
      fqiTrendSlope: 0.01,
      topFault: 'depth_short',
      maxSymmetryPct: null,
      tempoTrendSlope: null,
      reps: [],
    },
  };
}

describe('useAutoDebrief memory persistence (pipeline-v2)', () => {
  beforeEach(() => {
    mockListeners.clear();
    mockGenerate.mockReset();
    mockGetCached.mockReset();
    mockIsEnabled.mockReset();
    mockCacheBrief.mockReset();
    mockIsEnabled.mockReturnValue(true);
    mockCacheBrief.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env[FLAG];
    else process.env[FLAG] = originalFlag;
  });

  it('caches a SessionBrief after a successful generate when the flag is on', async () => {
    process.env[FLAG] = 'on';
    mockGenerate.mockResolvedValue({
      sessionId: 'sess-42',
      provider: 'openai',
      brief: 'Great session!',
      generatedAt: '2026-04-16T11:01:00.000Z',
    });
    const input = makeInput();

    renderHook(() => useAutoDebrief({ buildInput: () => input }));
    await act(async () => {
      await triggerFinished(makeEvent());
    });

    await waitFor(() => expect(mockCacheBrief).toHaveBeenCalledTimes(1));
    expect(mockCacheBrief).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess-42',
        topExerciseName: 'Back Squat',
        totalReps: 5,
        avgFqi: 0.82,
        notableNegative: 'depth_short',
      }),
    );
  });

  it('does not cache when the flag is off', async () => {
    delete process.env[FLAG];
    mockGenerate.mockResolvedValue({
      sessionId: 'sess-42',
      provider: 'openai',
      brief: 'Great session!',
      generatedAt: '2026-04-16T11:01:00.000Z',
    });
    const input = makeInput();

    renderHook(() => useAutoDebrief({ buildInput: () => input }));
    await act(async () => {
      await triggerFinished(makeEvent());
    });

    expect(mockCacheBrief).not.toHaveBeenCalled();
  });

  it('does not cache when generateAutoDebrief rejects', async () => {
    process.env[FLAG] = 'on';
    mockGenerate.mockRejectedValue(new Error('nope'));
    const input = makeInput();

    renderHook(() => useAutoDebrief({ buildInput: () => input }));
    await act(async () => {
      await triggerFinished(makeEvent());
    });

    expect(mockCacheBrief).not.toHaveBeenCalled();
  });
});
