/**
 * Unit tests for the Practice Session Zustand store.
 *
 * Verifies state transitions for the dry-run practice surface from issue #479.
 * The store is in-memory only — there is no persistence layer to mock, which
 * is precisely the invariant covered here.
 */

import { usePracticeSession, practiceSelectors } from '@/lib/stores/practice-session-store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const state = () => usePracticeSession.getState();

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
  resetStore();
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('practice-session-store — initial state', () => {
  it('starts in idle phase with zero counters', () => {
    const s = state();
    expect(s.phase).toBe('idle');
    expect(s.activeExerciseKey).toBeNull();
    expect(s.repCount).toBe(0);
    expect(s.currentFqi).toBeNull();
    expect(s.startedAtMs).toBeNull();
    expect(s.endedAtMs).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// start()
// ---------------------------------------------------------------------------

describe('practice-session-store — start()', () => {
  it('transitions to running with active exercise and fresh counters', () => {
    state().start('pullup');
    const s = state();
    expect(s.phase).toBe('running');
    expect(s.activeExerciseKey).toBe('pullup');
    expect(s.repCount).toBe(0);
    expect(s.currentFqi).toBeNull();
    expect(s.startedAtMs).not.toBeNull();
    expect(s.endedAtMs).toBeNull();
  });

  it('restarting after end() clears counters and timestamps', () => {
    state().start('pushup');
    state().setRepCount(5);
    state().setCurrentFqi(82);
    state().end();
    expect(state().phase).toBe('ended');

    state().start('squat');
    const s = state();
    expect(s.phase).toBe('running');
    expect(s.activeExerciseKey).toBe('squat');
    expect(s.repCount).toBe(0);
    expect(s.currentFqi).toBeNull();
    expect(s.endedAtMs).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// end()
// ---------------------------------------------------------------------------

describe('practice-session-store — end()', () => {
  it('transitions running → ended and stamps endedAtMs', () => {
    state().start('pullup');
    state().end();
    const s = state();
    expect(s.phase).toBe('ended');
    expect(s.endedAtMs).not.toBeNull();
  });

  it('is a no-op when called from idle', () => {
    state().end();
    expect(state().phase).toBe('idle');
    expect(state().endedAtMs).toBeNull();
  });

  it('preserves repCount and currentFqi for display post-end', () => {
    state().start('deadlift');
    state().setRepCount(7);
    state().setCurrentFqi(74);
    state().end();
    const s = state();
    expect(s.repCount).toBe(7);
    expect(s.currentFqi).toBe(74);
  });
});

// ---------------------------------------------------------------------------
// reset()
// ---------------------------------------------------------------------------

describe('practice-session-store — reset()', () => {
  it('returns the store to idle from any phase', () => {
    state().start('pullup');
    state().setRepCount(3);
    state().reset();
    const s = state();
    expect(s.phase).toBe('idle');
    expect(s.activeExerciseKey).toBeNull();
    expect(s.repCount).toBe(0);
    expect(s.currentFqi).toBeNull();
    expect(s.startedAtMs).toBeNull();
    expect(s.endedAtMs).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setActiveExercise()
// ---------------------------------------------------------------------------

describe('practice-session-store — setActiveExercise()', () => {
  it('swaps exercise and zeroes rep + fqi without leaving running phase', () => {
    state().start('pullup');
    state().setRepCount(4);
    state().setCurrentFqi(90);

    state().setActiveExercise('squat');
    const s = state();
    expect(s.phase).toBe('running');
    expect(s.activeExerciseKey).toBe('squat');
    expect(s.repCount).toBe(0);
    expect(s.currentFqi).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setRepCount / setCurrentFqi
// ---------------------------------------------------------------------------

describe('practice-session-store — counter setters', () => {
  it('setRepCount writes through', () => {
    state().setRepCount(11);
    expect(state().repCount).toBe(11);
  });

  it('setCurrentFqi accepts number or null', () => {
    state().setCurrentFqi(60);
    expect(state().currentFqi).toBe(60);
    state().setCurrentFqi(null);
    expect(state().currentFqi).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

describe('practice-session-store — selectors', () => {
  it('isRunning reflects phase === running', () => {
    expect(practiceSelectors.isRunning(state())).toBe(false);
    state().start('pullup');
    expect(practiceSelectors.isRunning(state())).toBe(true);
    state().end();
    expect(practiceSelectors.isRunning(state())).toBe(false);
  });

  it('hasEnded reflects phase === ended', () => {
    state().start('pushup');
    expect(practiceSelectors.hasEnded(state())).toBe(false);
    state().end();
    expect(practiceSelectors.hasEnded(state())).toBe(true);
  });

  it('durationMs is null when idle, non-negative when running/ended', () => {
    expect(practiceSelectors.durationMs(state())).toBeNull();
    state().start('squat');
    const running = practiceSelectors.durationMs(state());
    expect(running).not.toBeNull();
    expect(running as number).toBeGreaterThanOrEqual(0);

    state().end();
    const ended = practiceSelectors.durationMs(state());
    expect(ended).not.toBeNull();
    expect(ended as number).toBeGreaterThanOrEqual(0);
  });
});
