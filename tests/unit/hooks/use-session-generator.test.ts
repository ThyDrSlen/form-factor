jest.mock('expo-crypto', () => ({
  randomUUID: () => 'hook-uuid',
}));

import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useSessionGenerator } from '@/hooks/use-session-generator';
import type { CoachMessage } from '@/lib/services/coach-service';

const VALID_TEMPLATE = JSON.stringify({
  name: 'Hook Test',
  description: '',
  goal_profile: 'hypertrophy',
  exercises: [{ exercise_slug: 'pushup', sets: [{ target_reps: 10 }] }],
});

describe('useSessionGenerator', () => {
  it('initial state has no loading / result / error', () => {
    const { result } = renderHook(() =>
      useSessionGenerator({
        runtime: { userId: 'u', dispatch: jest.fn() },
      }),
    );
    expect(result.current.loading).toBe(false);
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('transitions loading -> result on success', async () => {
    const dispatch = jest.fn<Promise<CoachMessage>, [CoachMessage[]]>().mockResolvedValue({
      role: 'assistant',
      content: VALID_TEMPLATE,
    });
    const onSuccess = jest.fn();
    const { result } = renderHook(() =>
      useSessionGenerator({
        runtime: { userId: 'u', dispatch },
        onSuccess,
      }),
    );

    let returned;
    await act(async () => {
      returned = await result.current.generate({ intent: 'quick push' });
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.result?.template.name).toBe('Hook Test');
    expect(result.current.error).toBeNull();
    expect(onSuccess).toHaveBeenCalledWith(result.current.result);
    expect(returned).toEqual(result.current.result);
  });

  it('transitions loading -> error on dispatch failure', async () => {
    const dispatch = jest
      .fn<Promise<CoachMessage>, [CoachMessage[]]>()
      .mockRejectedValue(new Error('boom'));
    const onError = jest.fn();

    const { result } = renderHook(() =>
      useSessionGenerator({
        runtime: { userId: 'u', dispatch, maxRetries: 0 },
        onError,
      }),
    );

    let returned;
    await act(async () => {
      returned = await result.current.generate({ intent: 'x' });
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.result).toBeNull();
    expect((result.current.error as Error | null)?.message).toBe('boom');
    expect(onError).toHaveBeenCalled();
    expect(returned).toBeNull();
  });

  it('reset clears result + error + loading', async () => {
    const dispatch = jest.fn<Promise<CoachMessage>, [CoachMessage[]]>().mockResolvedValue({
      role: 'assistant',
      content: VALID_TEMPLATE,
    });
    const { result } = renderHook(() =>
      useSessionGenerator({ runtime: { userId: 'u', dispatch } }),
    );

    await act(async () => {
      await result.current.generate({ intent: 'x' });
    });
    expect(result.current.result).not.toBeNull();

    act(() => result.current.reset());
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('generate is referentially stable across re-renders', () => {
    const dispatch = jest.fn<Promise<CoachMessage>, [CoachMessage[]]>();
    const { result, rerender } = renderHook(() =>
      useSessionGenerator({ runtime: { userId: 'u', dispatch } }),
    );
    const first = result.current.generate;
    rerender({});
    expect(result.current.generate).toBe(first);
  });
});
