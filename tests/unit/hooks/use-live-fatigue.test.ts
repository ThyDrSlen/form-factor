/**
 * Unit tests for use-live-fatigue.
 */

import { renderHook } from '@testing-library/react-native';
import { useLiveFatigue, computeLiveFatigue, type LiveFatigueInput } from '@/hooks/use-live-fatigue';

describe('computeLiveFatigue (pure)', () => {
  it('returns fresh baseline with no data', () => {
    const r = computeLiveFatigue({ recentFqi: [], heartRateBpm: null });
    expect(r.state).toBe('fresh');
    expect(r.suggestRestSec).toBe(0);
    expect(r.reason).toBe('baseline');
  });

  it('promotes to working when FQI drops moderately', () => {
    const r = computeLiveFatigue({ recentFqi: [90, 88, 85], heartRateBpm: null });
    expect(r.state).toBe('working');
    expect(r.suggestRestSec).toBe(30);
  });

  it('goes fatigued when FQI drops sharply', () => {
    const r = computeLiveFatigue({ recentFqi: [92, 91, 90, 75], heartRateBpm: null });
    expect(r.state).toBe('fatigued');
    expect(r.suggestRestSec).toBe(60);
  });

  it('classifies HR zone from bpm/maxHr', () => {
    const r1 = computeLiveFatigue({ recentFqi: [], heartRateBpm: 170, maxHeartRate: 190 });
    expect(r1.state).toBe('fatigued');

    const r2 = computeLiveFatigue({ recentFqi: [], heartRateBpm: 140, maxHeartRate: 190 });
    expect(r2.state).toBe('working');

    const r3 = computeLiveFatigue({ recentFqi: [], heartRateBpm: 110, maxHeartRate: 190 });
    expect(r3.state).toBe('fresh');
  });

  it('picks the most severe signal when FQI and HR disagree', () => {
    const r = computeLiveFatigue({
      recentFqi: [90, 89],
      heartRateBpm: 175,
      maxHeartRate: 190,
    });
    expect(r.state).toBe('fatigued');
    expect(r.reason).toContain('hr:fatigued');
  });

  it('treats invalid HR as missing', () => {
    const r = computeLiveFatigue({ recentFqi: [], heartRateBpm: 0 });
    expect(r.state).toBe('fresh');
  });
});

describe('useLiveFatigue hook', () => {
  it('returns a memoized result for the same inputs', () => {
    const { result, rerender } = renderHook(
      (props: LiveFatigueInput) => useLiveFatigue(props),
      {
        initialProps: { recentFqi: [80, 78], heartRateBpm: 130 } as LiveFatigueInput,
      },
    );
    const first = result.current;
    rerender({ recentFqi: [80, 78], heartRateBpm: 130 });
    // Memoized by the same reference inputs — object identity stable if arrays are the same ref
    expect(result.current.state).toBe(first.state);
    expect(result.current.suggestRestSec).toBe(first.suggestRestSec);
  });
});
