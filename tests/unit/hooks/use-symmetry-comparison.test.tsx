import { renderHook, waitFor } from '@testing-library/react-native';
import {
  computeAsymmetryPct,
  SYMMETRY_THRESHOLD_PCT,
  useSymmetryComparison,
} from '@/hooks/use-symmetry-comparison';

const mockGet = jest.fn();
jest.mock('@/lib/services/rep-analytics', () => ({
  getBilateralRepHistory: (...args: unknown[]) => mockGet(...args),
}));

describe('computeAsymmetryPct (pure)', () => {
  it('returns 0 for symmetric inputs', () => {
    expect(computeAsymmetryPct(90, 90)).toBe(0);
  });

  it('computes a percentage relative to the larger side', () => {
    // |100-80| / 100 * 100 = 20
    expect(computeAsymmetryPct(100, 80)).toBe(20);
  });

  it('treats both-zero as a non-pathological 0%', () => {
    expect(computeAsymmetryPct(0, 0)).toBe(0);
  });

  it('returns null for one-sided tracking loss', () => {
    expect(computeAsymmetryPct(0, 90)).toBeNull();
    expect(computeAsymmetryPct(90, 0)).toBeNull();
  });

  it('returns null for non-finite inputs', () => {
    expect(computeAsymmetryPct(NaN, 90)).toBeNull();
    expect(computeAsymmetryPct(90, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('useSymmetryComparison', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('marks isFallback=true when the analytics stub returns []', async () => {
    mockGet.mockResolvedValueOnce([]);
    const { result } = renderHook(() => useSymmetryComparison('session-1'));
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.series).toEqual([]);
    expect(result.current.isFallback).toBe(true);
  });

  it('projects rep rows into asymmetry datum series', async () => {
    mockGet.mockResolvedValueOnce([
      { repNumber: 1, leftAngleDeg: 100, rightAngleDeg: 90, joint: 'elbow' },
      { repNumber: 2, leftAngleDeg: 80, rightAngleDeg: 80, joint: 'elbow' },
      // One-sided tracking loss → asymmetryPct = null.
      { repNumber: 3, leftAngleDeg: 0, rightAngleDeg: 75, joint: 'elbow' },
    ]);
    const { result } = renderHook(() => useSymmetryComparison('session-2'));
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.series).toHaveLength(3);
    expect(result.current.series[0].asymmetryPct).toBe(10);
    expect(result.current.series[1].asymmetryPct).toBe(0);
    expect(result.current.series[2].asymmetryPct).toBeNull();
    expect(result.current.isFallback).toBe(false);
  });

  it('captures errors thrown by the analytics service', async () => {
    mockGet.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useSymmetryComparison('session-3'));
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.error?.message).toBe('boom');
    expect(result.current.series).toEqual([]);
  });

  it('exposes the configured threshold constant', () => {
    expect(SYMMETRY_THRESHOLD_PCT).toBe(15);
  });
});
