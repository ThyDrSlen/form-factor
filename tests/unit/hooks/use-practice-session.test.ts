/**
 * Unit tests for use-practice-session.
 *
 * Critical invariant from issue #479 acceptance criteria:
 *   "Practice mode completes a full squat rep without calling
 *    upsertSessionMetrics, createWorkout, or watchBridge.emit."
 *
 * We mock all three (plus a few cousins) and assert zero calls after a
 * full practice lifecycle including multiple reps, exercise swaps, and
 * end-of-session.
 */

import { renderHook, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mocks — hoisted by jest.mock. Any symbol the hook might transitively pull
// in that could touch persistence is stubbed so we can assert-zero-calls.
// ---------------------------------------------------------------------------

const mockUpsertSessionMetrics = jest.fn();
const mockLogCueEvent = jest.fn();
jest.mock('@/lib/services/cue-logger', () => ({
  upsertSessionMetrics: (...args: unknown[]) => mockUpsertSessionMetrics(...args),
  logCueEvent: (...args: unknown[]) => mockLogCueEvent(...args),
  generateSessionId: jest.fn(() => 'session-id-mock'),
}));

const mockLogRep = jest.fn();
jest.mock('@/lib/services/rep-logger', () => ({
  logRep: (...args: unknown[]) => mockLogRep(...args),
}));

const mockGenericLocalUpsert = jest.fn();
const mockGenericSoftDelete = jest.fn();
jest.mock('@/lib/services/database/generic-sync', () => ({
  genericLocalUpsert: (...args: unknown[]) => mockGenericLocalUpsert(...args),
  genericSoftDelete: (...args: unknown[]) => mockGenericSoftDelete(...args),
  genericGetAll: jest.fn().mockResolvedValue([]),
}));

const mockWatchSendMessage = jest.fn();
const mockWatchUpdateContext = jest.fn();
jest.mock('@/lib/watch-connectivity', () => ({
  sendMessage: (...args: unknown[]) => mockWatchSendMessage(...args),
  updateWatchContext: (...args: unknown[]) => mockWatchUpdateContext(...args),
  watchEvents: { addListener: jest.fn(() => ({ remove: jest.fn() })) },
  getIsPaired: jest.fn().mockResolvedValue(false),
  getIsWatchAppInstalled: jest.fn().mockResolvedValue(false),
  getReachability: jest.fn().mockResolvedValue({ reachable: false }),
}));

const mockStartSession = jest.fn();
const mockFinishSession = jest.fn();
jest.mock('@/lib/stores/session-runner', () => ({
  useSessionRunner: Object.assign(
    jest.fn(() => ({
      startSession: mockStartSession,
      finishSession: mockFinishSession,
    })),
    {
      getState: jest.fn(() => ({
        startSession: mockStartSession,
        finishSession: mockFinishSession,
      })),
      setState: jest.fn(),
    }
  ),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { usePracticeSessionHook } from '@/hooks/use-practice-session';
import { usePracticeSession } from '@/lib/stores/practice-session-store';

function resetStore(): void {
  usePracticeSession.setState({
    phase: 'idle',
    activeExerciseKey: null,
    repCount: 0,
    currentFqi: null,
    startedAtMs: null,
    endedAtMs: null,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetStore();
});

// ---------------------------------------------------------------------------
// Persistence short-circuit — the hero test
// ---------------------------------------------------------------------------

describe('use-practice-session — persistence short-circuit', () => {
  it('does not call upsertSessionMetrics, rep-logger, or watch bridge through a full squat session', () => {
    const { result } = renderHook(() => usePracticeSessionHook());

    act(() => {
      result.current.start('squat');
    });
    expect(result.current.isRunning).toBe(true);

    // Simulate 5 reps + FQI updates.
    for (let i = 0; i < 5; i++) {
      act(() => {
        result.current.handleRep();
        result.current.setCurrentFqi(80 + i);
      });
    }
    expect(result.current.repCount).toBe(5);
    expect(result.current.currentFqi).toBe(84);

    act(() => {
      result.current.end();
    });
    expect(result.current.hasEnded).toBe(true);

    // The whole point of practice mode: zero persistence.
    expect(mockUpsertSessionMetrics).not.toHaveBeenCalled();
    expect(mockLogCueEvent).not.toHaveBeenCalled();
    expect(mockLogRep).not.toHaveBeenCalled();
    expect(mockGenericLocalUpsert).not.toHaveBeenCalled();
    expect(mockGenericSoftDelete).not.toHaveBeenCalled();
    expect(mockWatchSendMessage).not.toHaveBeenCalled();
    expect(mockWatchUpdateContext).not.toHaveBeenCalled();
    expect(mockStartSession).not.toHaveBeenCalled();
    expect(mockFinishSession).not.toHaveBeenCalled();
  });

  it('stays persistence-free across exercise swaps', () => {
    const { result } = renderHook(() => usePracticeSessionHook());
    act(() => {
      result.current.start('pullup');
    });
    act(() => {
      result.current.handleRep();
      result.current.setActiveExercise('pushup');
    });
    act(() => {
      result.current.handleRep();
      result.current.end();
    });

    expect(mockUpsertSessionMetrics).not.toHaveBeenCalled();
    expect(mockLogRep).not.toHaveBeenCalled();
    expect(mockGenericLocalUpsert).not.toHaveBeenCalled();
    expect(mockWatchSendMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Exposed surface
// ---------------------------------------------------------------------------

describe('use-practice-session — exposed values', () => {
  it('exposes derived flags from the store', () => {
    const { result } = renderHook(() => usePracticeSessionHook());
    expect(result.current.phase).toBe('idle');
    expect(result.current.isRunning).toBe(false);
    expect(result.current.hasEnded).toBe(false);
    expect(result.current.durationMs).toBeNull();

    act(() => {
      result.current.start('deadlift');
    });
    expect(result.current.phase).toBe('running');
    expect(result.current.isRunning).toBe(true);
    expect(result.current.activeExerciseKey).toBe('deadlift');
  });

  it('setRepCount and handleRep both push the store forward', () => {
    const { result } = renderHook(() => usePracticeSessionHook());
    act(() => {
      result.current.start('pullup');
      result.current.setRepCount(3);
    });
    expect(result.current.repCount).toBe(3);
    act(() => {
      result.current.handleRep();
    });
    expect(result.current.repCount).toBe(4);
  });

  it('reset clears the store', () => {
    const { result } = renderHook(() => usePracticeSessionHook());
    act(() => {
      result.current.start('pushup');
      result.current.handleRep();
      result.current.reset();
    });
    expect(result.current.phase).toBe('idle');
    expect(result.current.repCount).toBe(0);
    expect(result.current.activeExerciseKey).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// autoResetOnUnmount
// ---------------------------------------------------------------------------

describe('use-practice-session — autoResetOnUnmount', () => {
  it('does not reset on unmount when option is false (default)', () => {
    const { result, unmount } = renderHook(() => usePracticeSessionHook());
    act(() => {
      result.current.start('pullup');
      result.current.setRepCount(2);
    });
    unmount();
    expect(usePracticeSession.getState().phase).toBe('running');
    expect(usePracticeSession.getState().repCount).toBe(2);
  });

  it('resets on unmount when option is true', () => {
    const { result, unmount } = renderHook(() =>
      usePracticeSessionHook({ autoResetOnUnmount: true })
    );
    act(() => {
      result.current.start('pullup');
      result.current.setRepCount(4);
    });
    unmount();
    expect(usePracticeSession.getState().phase).toBe('idle');
    expect(usePracticeSession.getState().repCount).toBe(0);
  });
});
