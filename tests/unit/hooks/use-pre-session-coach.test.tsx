import { act, renderHook, waitFor } from '@testing-library/react-native';

import { usePreSessionCoach } from '@/hooks/use-pre-session-coach';
import { WARMUP_COACH_FLAG_ENV_VAR } from '@/lib/services/warmup-coach-flag';
import type { WarmupPlan } from '@/lib/services/coach-warmup-provider';

const flagOriginal = process.env[WARMUP_COACH_FLAG_ENV_VAR];

const SAMPLE_PLAN: WarmupPlan = {
  name: 'Squat day warmup',
  duration_min: 6,
  movements: [
    { name: 'Hip flow', focus: 'mobility', intensity: 'low', duration_seconds: 60 },
    { name: 'Goblet squat', focus: 'activation', intensity: 'medium', reps: 10 },
  ],
};

describe('usePreSessionCoach', () => {
  afterEach(() => {
    if (flagOriginal === undefined) {
      delete process.env[WARMUP_COACH_FLAG_ENV_VAR];
    } else {
      process.env[WARMUP_COACH_FLAG_ENV_VAR] = flagOriginal;
    }
  });

  it('returns enabled=false when flag is off', () => {
    delete process.env[WARMUP_COACH_FLAG_ENV_VAR];
    const { result } = renderHook(() => usePreSessionCoach());
    expect(result.current.enabled).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(result.current.warmup).toBeNull();
  });

  it('generateWarmup is a no-op when flag is off', async () => {
    delete process.env[WARMUP_COACH_FLAG_ENV_VAR];
    const providerOverride = jest.fn(() => Promise.resolve(SAMPLE_PLAN));
    const { result } = renderHook(() =>
      usePreSessionCoach({ providerOverride }),
    );

    let returned: WarmupPlan | null | undefined;
    await act(async () => {
      returned = await result.current.generateWarmup({ exerciseSlugs: ['squat'] });
    });

    expect(returned).toBeNull();
    expect(providerOverride).not.toHaveBeenCalled();
  });

  it('generateWarmup resolves with the provider plan when flag on', async () => {
    process.env[WARMUP_COACH_FLAG_ENV_VAR] = '1';
    const providerOverride = jest.fn(() => Promise.resolve(SAMPLE_PLAN));
    const { result } = renderHook(() =>
      usePreSessionCoach({ providerOverride }),
    );

    let returned: WarmupPlan | null | undefined;
    await act(async () => {
      returned = await result.current.generateWarmup({ exerciseSlugs: ['squat'] });
    });

    expect(returned).toEqual(SAMPLE_PLAN);
    expect(providerOverride).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.warmup).toEqual(SAMPLE_PLAN);
    expect(result.current.error).toBeNull();
  });

  it('exposes provider rejections via error state', async () => {
    process.env[WARMUP_COACH_FLAG_ENV_VAR] = 'true';
    const providerOverride = jest.fn(() => Promise.reject(new Error('schema bad')));
    const { result } = renderHook(() =>
      usePreSessionCoach({ providerOverride }),
    );

    await act(async () => {
      const r = await result.current.generateWarmup({ exerciseSlugs: ['squat'] });
      expect(r).toBeNull();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('schema bad');
    expect(result.current.warmup).toBeNull();
  });

  it('bypassFlag lets tests exercise the generator regardless of env', async () => {
    delete process.env[WARMUP_COACH_FLAG_ENV_VAR];
    const providerOverride = jest.fn(() => Promise.resolve(SAMPLE_PLAN));
    const { result } = renderHook(() =>
      usePreSessionCoach({ providerOverride, bypassFlag: true }),
    );

    await act(async () => {
      await result.current.generateWarmup({ exerciseSlugs: ['squat'] });
    });

    expect(providerOverride).toHaveBeenCalledTimes(1);
    expect(result.current.warmup).toEqual(SAMPLE_PLAN);
    expect(result.current.enabled).toBe(true);
  });

  it('reset clears state without a new generator call', async () => {
    process.env[WARMUP_COACH_FLAG_ENV_VAR] = '1';
    const providerOverride = jest.fn(() => Promise.resolve(SAMPLE_PLAN));
    const { result } = renderHook(() =>
      usePreSessionCoach({ providerOverride }),
    );

    await act(async () => {
      await result.current.generateWarmup({ exerciseSlugs: ['squat'] });
    });
    await waitFor(() => expect(result.current.warmup).toEqual(SAMPLE_PLAN));

    act(() => {
      result.current.reset();
    });
    expect(result.current.warmup).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
