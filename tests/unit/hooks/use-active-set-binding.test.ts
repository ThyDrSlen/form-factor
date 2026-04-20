/**
 * Unit tests for useActiveSetBinding.
 */

import { renderHook, act } from '@testing-library/react-native';

const mockUpdateSet = jest.fn().mockResolvedValue(undefined);
const mockCompleteSet = jest.fn().mockResolvedValue(undefined);

// Prefix with `mock` so jest allows it inside the factory.
const mockSessionState: {
  activeSession: unknown;
  exercises: unknown[];
  sets: Record<string, unknown[]>;
  updateSet: jest.Mock;
  completeSet: jest.Mock;
} = {
  activeSession: null,
  exercises: [],
  sets: {},
  updateSet: mockUpdateSet,
  completeSet: mockCompleteSet,
};

jest.mock('@/lib/stores/session-runner', () => ({
  useSessionRunner: (selector: (s: typeof mockSessionState) => unknown) => selector(mockSessionState),
}));

jest.mock('@/lib/workouts', () => jest.requireActual('@/lib/workouts'));

import { useActiveSetBinding } from '@/hooks/use-active-set-binding';

function setSessionState(patch: Partial<typeof mockSessionState>): void {
  Object.assign(mockSessionState, patch);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSessionState.activeSession = null;
  mockSessionState.exercises = [];
  mockSessionState.sets = {};
  mockSessionState.updateSet = mockUpdateSet;
  mockSessionState.completeSet = mockCompleteSet;
});

describe('useActiveSetBinding', () => {
  it('returns unbound state when there is no active session', () => {
    const { result } = renderHook(() => useActiveSetBinding('pullup'));
    expect(result.current.isBound).toBe(false);
    expect(result.current.activeSet).toBeNull();
    expect(result.current.setLabel).toBe('');
  });

  it('matches by exercise name prefix when a session is active', () => {
    setSessionState({
      activeSession: { id: 'sess-1' },
      exercises: [
        { id: 'se-1', exercise_id: 'ex-abc', exercise: { id: 'ex-abc', name: 'Pull-Up' } },
      ],
      sets: {
        'se-1': [
          { id: 'set-1', completed_at: '2024-01-01T00:00:00.000Z' },
          { id: 'set-2', completed_at: null },
          { id: 'set-3', completed_at: null },
        ],
      },
    });

    const { result } = renderHook(() => useActiveSetBinding('pullup'));
    expect(result.current.isBound).toBe(true);
    expect(result.current.activeSet).toMatchObject({ id: 'set-2' });
    expect(result.current.activeSetIndex).toBe(2);
    expect(result.current.totalSets).toBe(3);
    expect(result.current.setLabel).toBe('Set 2 of 3');
  });

  it('falls back to exercise_id containing the mode when name does not match', () => {
    setSessionState({
      activeSession: { id: 'sess-1' },
      exercises: [
        { id: 'se-1', exercise_id: 'ex-squat-back', exercise: { id: 'ex-squat-back', name: 'Back Work' } },
      ],
      sets: {
        'se-1': [{ id: 'set-1', completed_at: null }],
      },
    });
    const { result } = renderHook(() => useActiveSetBinding('squat'));
    expect(result.current.sessionExercise?.id).toBe('se-1');
  });

  it('commitReps updates actual_reps then completes the pending set', async () => {
    setSessionState({
      activeSession: { id: 'sess-1' },
      exercises: [
        { id: 'se-1', exercise_id: 'ex-a', exercise: { id: 'ex-a', name: 'Push-Up' } },
      ],
      sets: {
        'se-1': [{ id: 'set-pending', completed_at: null }],
      },
    });

    const { result } = renderHook(() => useActiveSetBinding('pushup'));
    let returned: string | null = null;
    await act(async () => {
      returned = await result.current.commitReps(8.7);
    });
    expect(returned).toBe('set-pending');
    expect(mockUpdateSet).toHaveBeenCalledWith('set-pending', { actual_reps: 9 });
    expect(mockCompleteSet).toHaveBeenCalledWith('set-pending');
  });

  it('commitReps is a no-op when nothing is bound', async () => {
    const { result } = renderHook(() => useActiveSetBinding('pullup'));
    const ret = await result.current.commitReps(10);
    expect(ret).toBeNull();
    expect(mockUpdateSet).not.toHaveBeenCalled();
    expect(mockCompleteSet).not.toHaveBeenCalled();
  });
});
