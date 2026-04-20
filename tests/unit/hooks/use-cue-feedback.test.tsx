import { act, renderHook, waitFor } from '@testing-library/react-native';

import {
  __clearListenersForTests,
  useCueFeedback,
} from '@/hooks/use-cue-feedback';
import {
  __resetForTests,
  recordFeedback,
} from '@/lib/services/coach-cue-feedback';

describe('useCueFeedback', () => {
  beforeEach(async () => {
    await __resetForTests();
    __clearListenersForTests();
  });

  it('hydrates with existing preferences for the exercise', async () => {
    await recordFeedback({ exerciseId: 'squat', cueKey: 'kneesout', vote: 'up' });
    await recordFeedback({ exerciseId: 'squat', cueKey: 'heels', vote: 'down' });

    const { result } = renderHook(() => useCueFeedback('squat'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.preferences).toHaveLength(2);
    expect(result.current.getScore('kneesout')).toBe(1);
    expect(result.current.getScore('heels')).toBe(-1);
    expect(result.current.getScore('never-voted')).toBe(0);
  });

  it('returns empty + loading=false when exerciseId is undefined', async () => {
    const { result } = renderHook(() => useCueFeedback(undefined));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.preferences).toEqual([]);
  });

  it('recordVote persists and updates state in-place', async () => {
    const { result } = renderHook(() => useCueFeedback('squat'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.recordVote({ cueKey: 'kneesout', vote: 'up' });
    });

    await waitFor(() => {
      expect(result.current.getScore('kneesout')).toBe(1);
    });
  });

  it('recordVote broadcasts to sibling consumers', async () => {
    const { result: a } = renderHook(() => useCueFeedback('squat'));
    const { result: b } = renderHook(() => useCueFeedback('squat'));
    await waitFor(() => expect(a.current.loading).toBe(false));
    await waitFor(() => expect(b.current.loading).toBe(false));

    await act(async () => {
      await a.current.recordVote({ cueKey: 'hinge', vote: 'down' });
    });

    await waitFor(() => {
      expect(b.current.getScore('hinge')).toBe(-1);
    });
  });

  it('switches exercise context cleanly', async () => {
    await recordFeedback({ exerciseId: 'squat', cueKey: 'a', vote: 'up' });
    await recordFeedback({ exerciseId: 'deadlift', cueKey: 'a', vote: 'down' });

    const { result, rerender } = renderHook(
      ({ exerciseId }: { exerciseId: string | undefined }) => useCueFeedback(exerciseId),
      { initialProps: { exerciseId: 'squat' as string | undefined } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.getScore('a')).toBe(1);

    rerender({ exerciseId: 'deadlift' });
    await waitFor(() => expect(result.current.getScore('a')).toBe(-1));
  });

  it('clearAll wipes state across consumers', async () => {
    await recordFeedback({ exerciseId: 'squat', cueKey: 'k', vote: 'up' });
    const { result } = renderHook(() => useCueFeedback('squat'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.preferences).toHaveLength(1);

    await act(async () => {
      await result.current.clearAll();
    });

    await waitFor(() => expect(result.current.preferences).toHaveLength(0));
  });

  it('does not record a vote when exerciseId is undefined', async () => {
    const { result } = renderHook(() => useCueFeedback(undefined));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.recordVote({ cueKey: 'k', vote: 'up' });
    });

    expect(result.current.preferences).toEqual([]);
  });
});
