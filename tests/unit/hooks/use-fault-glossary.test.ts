import { renderHook } from '@testing-library/react-native';
import { useFaultGlossary } from '@/hooks/use-fault-glossary';

describe('useFaultGlossary', () => {
  it('returns null when faultId is null', () => {
    const { result } = renderHook(() => useFaultGlossary('squat', null));
    expect(result.current).toBeNull();
  });

  it('returns the specific entry when both ids provided', () => {
    const { result } = renderHook(() =>
      useFaultGlossary('squat', 'knee_valgus'),
    );
    expect(result.current?.exerciseId).toBe('squat');
    expect(result.current?.faultId).toBe('knee_valgus');
  });

  it('falls back to first across-exercise match when only faultId given', () => {
    const { result } = renderHook(() =>
      useFaultGlossary(null, 'incomplete_lockout'),
    );
    expect(result.current).not.toBeNull();
    expect(result.current?.faultId).toBe('incomplete_lockout');
  });

  it('returns null when neither pair nor fallback exists', () => {
    const { result } = renderHook(() =>
      useFaultGlossary('squat', 'nonexistent_fault'),
    );
    expect(result.current).toBeNull();
  });

  it('memoizes the result when inputs are stable', () => {
    const { result, rerender } = renderHook(
      ({ ex, f }: { ex: string; f: string }) => useFaultGlossary(ex, f),
      { initialProps: { ex: 'squat', f: 'knee_valgus' } },
    );
    const first = result.current;
    rerender({ ex: 'squat', f: 'knee_valgus' });
    expect(result.current).toBe(first);
  });
});
