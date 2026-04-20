import { renderHook } from '@testing-library/react-native';
import { useRepCounterPosition } from '@/hooks/use-rep-counter-position';

describe('useRepCounterPosition', () => {
  it('returns visible=false when no joints supplied', () => {
    const { result } = renderHook(() =>
      useRepCounterPosition({ repCount: 0 })
    );
    expect(result.current.visible).toBe(false);
    expect(result.current.repCount).toBe(0);
  });

  it('passes through repCount and projects joints2D', () => {
    const { result } = renderHook(() =>
      useRepCounterPosition({
        repCount: 5,
        phase: 'pull',
        joints2D: [{ name: 'hips_joint', x: 0.4, y: 0.6, isTracked: true }],
      })
    );
    expect(result.current.repCount).toBe(5);
    expect(result.current.visible).toBe(true);
    expect(result.current.x).toBe(0.4);
    expect(result.current.y).toBe(0.6);
    expect(result.current.opacity).toBe(1);
  });

  it('fades when phase=rest', () => {
    const { result } = renderHook(() =>
      useRepCounterPosition({
        repCount: 5,
        phase: 'rest',
        joints2D: [{ name: 'hips_joint', x: 0.5, y: 0.5, isTracked: true }],
      })
    );
    expect(result.current.opacity).toBeLessThan(1);
  });
});
