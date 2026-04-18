import { renderHook, waitFor } from '@testing-library/react-native';
import { usePersonalizedCue } from '@/hooks/use-personalized-cue';
import {
  setPersonalizedCueRunner,
  __resetPersonalizedCueForTests,
  type CueInput,
  type PersonalizedCueRunner,
} from '@/lib/services/personalized-cue';

describe('usePersonalizedCue', () => {
  afterEach(() => {
    __resetPersonalizedCueForTests();
  });

  it('stays idle when input is null', () => {
    const { result } = renderHook(() => usePersonalizedCue(null));
    expect(result.current.status).toBe('idle');
    expect(result.current.output).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('transitions loading → ready with the static output', async () => {
    const input: CueInput = {
      exerciseId: 'squat',
      faultId: 'shallow_depth',
    };
    const { result } = renderHook(() => usePersonalizedCue(input));

    // Should move to loading immediately
    expect(result.current.status).toBe('loading');

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.output).not.toBeNull();
    expect(result.current.output?.source).toBe('static');
    expect(result.current.error).toBeNull();
  });

  it('surfaces errors from the runner', async () => {
    const broken: PersonalizedCueRunner = {
      async getCue() {
        throw new Error('runner exploded');
      },
    };
    setPersonalizedCueRunner(broken);

    const input: CueInput = {
      exerciseId: 'squat',
      faultId: 'shallow_depth',
    };
    const { result } = renderHook(() => usePersonalizedCue(input));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error?.message).toBe('runner exploded');
    expect(result.current.output).toBeNull();
  });

  it('does not re-run when userHistory arrays are structurally equal but different identity', async () => {
    let calls = 0;
    const spy: PersonalizedCueRunner = {
      async getCue(input) {
        calls += 1;
        return { cue: `call ${calls}`, referencesHistory: false, source: 'static' };
      },
    };
    setPersonalizedCueRunner(spy);

    const historyA = [
      { faultId: 'shallow_depth', lastSeenSessionsAgo: 0, totalOccurrences: 1 },
    ];
    const historyB = [
      { faultId: 'shallow_depth', lastSeenSessionsAgo: 0, totalOccurrences: 1 },
    ];

    const { result, rerender } = renderHook(
      ({ history }: { history: typeof historyA }) =>
        usePersonalizedCue({
          exerciseId: 'squat',
          faultId: 'shallow_depth',
          userHistory: history,
        }),
      { initialProps: { history: historyA } },
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(calls).toBe(1);

    // New array reference, same structural content — key must not change
    rerender({ history: historyB });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(calls).toBe(1);
  });

  it('does re-run when userHistory content actually changes', async () => {
    let calls = 0;
    const spy: PersonalizedCueRunner = {
      async getCue() {
        calls += 1;
        return { cue: `call ${calls}`, referencesHistory: false, source: 'static' };
      },
    };
    setPersonalizedCueRunner(spy);

    const { result, rerender } = renderHook(
      ({ occurrences }: { occurrences: number }) =>
        usePersonalizedCue({
          exerciseId: 'squat',
          faultId: 'shallow_depth',
          userHistory: [
            { faultId: 'shallow_depth', lastSeenSessionsAgo: 0, totalOccurrences: occurrences },
          ],
        }),
      { initialProps: { occurrences: 1 } },
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(calls).toBe(1);

    rerender({ occurrences: 3 });
    await waitFor(() => expect(result.current.output?.cue).toContain('call 2'));
    expect(calls).toBe(2);
  });
});
