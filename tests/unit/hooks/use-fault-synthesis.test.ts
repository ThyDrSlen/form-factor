import { renderHook, waitFor } from '@testing-library/react-native';
import { useFaultSynthesis } from '@/hooks/use-fault-synthesis';
import {
  setFaultExplainerRunner,
  __resetFaultExplainerForTests,
  type FaultExplainer,
} from '@/lib/services/fault-explainer';

describe('useFaultSynthesis', () => {
  beforeEach(() => {
    __resetFaultExplainerForTests();
  });

  it('stays idle when faultIds is empty', () => {
    const { result } = renderHook(() =>
      useFaultSynthesis({ exerciseId: 'squat', faultIds: [] }),
    );
    expect(result.current.status).toBe('idle');
    expect(result.current.output).toBeNull();
  });

  it('stays idle when exerciseId is missing', () => {
    const { result } = renderHook(() =>
      useFaultSynthesis({ exerciseId: null, faultIds: ['shallow_depth'] }),
    );
    expect(result.current.status).toBe('idle');
  });

  it('stays idle when disabled', () => {
    const { result } = renderHook(() =>
      useFaultSynthesis({
        exerciseId: 'squat',
        faultIds: ['shallow_depth'],
        disabled: true,
      }),
    );
    expect(result.current.status).toBe('idle');
  });

  it('resolves with the static fallback synthesis for a multi-fault input', async () => {
    const { result } = renderHook(() =>
      useFaultSynthesis({
        exerciseId: 'squat',
        faultIds: ['shallow_depth', 'forward_lean', 'hip_shift'],
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.output?.source).toBe('static-fallback');
    expect(result.current.output?.synthesizedExplanation.length).toBeGreaterThan(40);
    expect(result.current.output?.primaryFaultId).not.toBeNull();
  });

  it('surfaces errors from the runner', async () => {
    const broken: FaultExplainer = {
      async synthesize() {
        throw new Error('model crashed');
      },
    };
    setFaultExplainerRunner(broken);

    const { result } = renderHook(() =>
      useFaultSynthesis({
        exerciseId: 'squat',
        faultIds: ['shallow_depth'],
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error?.message).toBe('model crashed');
  });

  it('reruns when faultIds change', async () => {
    let calls = 0;
    const spy: FaultExplainer = {
      async synthesize(input) {
        calls += 1;
        return {
          synthesizedExplanation: `call ${calls}: ${input.faultIds.join(',')}`,
          primaryFaultId: input.faultIds[0] ?? null,
          rootCauseHypothesis: null,
          confidence: 0.9,
          source: 'gemma-local',
        };
      },
    };
    setFaultExplainerRunner(spy);

    const { result, rerender } = renderHook(
      ({ faultIds }: { faultIds: string[] }) =>
        useFaultSynthesis({ exerciseId: 'squat', faultIds }),
      { initialProps: { faultIds: ['shallow_depth'] } },
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(calls).toBe(1);

    rerender({ faultIds: ['forward_lean'] });
    await waitFor(() =>
      expect(result.current.output?.synthesizedExplanation).toContain('forward_lean'),
    );
    expect(calls).toBe(2);
  });

  it('does not rerun when inputs are structurally equal', async () => {
    let calls = 0;
    const spy: FaultExplainer = {
      async synthesize() {
        calls += 1;
        return {
          synthesizedExplanation: 'stable',
          primaryFaultId: null,
          rootCauseHypothesis: null,
          confidence: 0.9,
          source: 'gemma-local',
        };
      },
    };
    setFaultExplainerRunner(spy);

    const { result, rerender } = renderHook(
      ({ faultIds }: { faultIds: string[] }) =>
        useFaultSynthesis({ exerciseId: 'squat', faultIds }),
      { initialProps: { faultIds: ['shallow_depth', 'forward_lean'] } },
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(calls).toBe(1);

    // New array, same contents → stable key, no rerun
    rerender({ faultIds: ['forward_lean', 'shallow_depth'] });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(calls).toBe(1);
  });
});
