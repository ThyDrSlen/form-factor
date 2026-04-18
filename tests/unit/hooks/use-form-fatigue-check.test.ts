import { renderHook } from '@testing-library/react-native';
import { useFormFatigueCheck } from '@/hooks/use-form-fatigue-check';
import type { SetFqiPoint } from '@/lib/services/form-fatigue-detector';

function sets(values: number[]): SetFqiPoint[] {
  return values.map((avgFqi, idx) => ({ setIndex: idx + 1, avgFqi }));
}

describe('useFormFatigueCheck', () => {
  it('returns an assessment matching the underlying detector', () => {
    const { result } = renderHook(() => useFormFatigueCheck(sets([90, 70, 65])));
    expect(result.current.severity).toBe('moderate');
    expect(result.current.peakFqi).toBe(90);
  });

  it('honors option overrides', () => {
    const input = sets([90, 85, 80]);
    const defaults = renderHook(() => useFormFatigueCheck(input));
    expect(defaults.result.current.severity).toBe('low');
    const strict = renderHook(() =>
      useFormFatigueCheck(input, { dropThreshold: 0.03 }),
    );
    expect(strict.result.current.severity).toBe('moderate');
  });

  it('memoizes the assessment when inputs are stable', () => {
    const input = sets([90, 80, 70]);
    const { result, rerender } = renderHook(
      ({ s }: { s: SetFqiPoint[] }) => useFormFatigueCheck(s),
      { initialProps: { s: input } },
    );
    const first = result.current;
    rerender({ s: input });
    expect(result.current).toBe(first);
  });
});
