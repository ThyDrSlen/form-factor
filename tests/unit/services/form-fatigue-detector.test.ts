import {
  detectFormFatigue,
  type SetFqiPoint,
} from '@/lib/services/form-fatigue-detector';

function points(values: readonly (number | null)[]): SetFqiPoint[] {
  return values.map((avgFqi, idx) => ({
    setIndex: idx + 1,
    avgFqi: avgFqi as number,
  }));
}

describe('detectFormFatigue', () => {
  it('returns none with not_enough_sets when fewer than minSets provided', () => {
    const result = detectFormFatigue(points([82, 80]));
    expect(result.severity).toBe('none');
    expect(result.reason).toBe('not_enough_sets');
    expect(result.peakFqi).toBeNull();
    expect(result.recentAvgFqi).toBeNull();
  });

  it('returns none when form is flat or improving', () => {
    // Monotonic up → windowed avg is just below peak but within noiseFloor.
    const result = detectFormFatigue(points([80, 85, 90]));
    expect(result.severity).toBe('none');
    expect(result.reason).toBe('no_drop_detected');
    expect(result.peakFqi).toBe(90);
  });

  it('returns low severity for a small drop below threshold', () => {
    const result = detectFormFatigue(points([90, 88, 87]));
    expect(result.severity).toBe('low');
    expect(result.reason).toBe('drop_below_threshold');
    expect(result.dropRatio).toBeGreaterThan(0);
    expect(result.dropRatio! < 0.15).toBe(true);
  });

  it('returns moderate severity when drop exceeds threshold', () => {
    const result = detectFormFatigue(points([90, 70, 65]));
    expect(result.severity).toBe('moderate');
    expect(result.reason).toBe('moderate_drop');
    expect(result.dropRatio).toBeGreaterThanOrEqual(0.15);
    expect(result.dropRatio! < 0.3).toBe(true);
  });

  it('returns high severity when drop is more than 2x threshold', () => {
    const result = detectFormFatigue(points([95, 80, 60, 55]));
    expect(result.severity).toBe('high');
    expect(result.reason).toBe('severe_drop');
    expect(result.dropRatio).toBeGreaterThanOrEqual(0.3);
  });

  it('honors custom minSets option', () => {
    const result = detectFormFatigue(points([90, 70]), { minSets: 2 });
    expect(result.reason).not.toBe('not_enough_sets');
  });

  it('honors custom windowSize by averaging only the tail', () => {
    // Sets 1-5 are 90 (peak). Last 2 are 60 → should be detected as severe drop
    // when windowSize=2 even though earlier sets are fine.
    const sets = points([90, 90, 90, 60, 60]);
    const result = detectFormFatigue(sets, { windowSize: 2 });
    expect(result.recentAvgFqi).toBe(60);
    expect(result.peakFqi).toBe(90);
    expect(result.severity).toBe('high');
  });

  it('honors custom dropThreshold', () => {
    // drop = (90 - (90+85+80)/3)/90 = 5.56%. With a stricter 3% threshold
    // and a 0.01 noise floor, this becomes 'moderate' instead of 'low'.
    const strict = detectFormFatigue(points([90, 85, 80]), {
      dropThreshold: 0.03,
    });
    expect(strict.severity).toBe('moderate');
  });

  it('ignores non-finite FQI values', () => {
    const result = detectFormFatigue([
      { setIndex: 1, avgFqi: 80 },
      { setIndex: 2, avgFqi: Number.NaN },
      { setIndex: 3, avgFqi: 75 },
      { setIndex: 4, avgFqi: 70 },
    ]);
    expect(result.peakFqi).toBe(80);
    expect(result.recentAvgFqi).toBeCloseTo((80 + 75 + 70) / 3, 2);
  });

  it('treats peakFqi=0 safely (no divide-by-zero)', () => {
    const result = detectFormFatigue(points([0, 0, 0]));
    expect(result.severity).toBe('none');
    expect(result.reason).toBe('no_drop_detected');
    expect(result.dropRatio).toBe(0);
  });

  it('always attaches a non-empty recommendation', () => {
    const cases = [
      points([80]),
      points([80, 82, 85]),
      points([85, 84, 83]),
      points([90, 80, 70]),
      points([95, 60, 50]),
    ];
    for (const sets of cases) {
      const result = detectFormFatigue(sets);
      expect(typeof result.recommendation).toBe('string');
      expect(result.recommendation.length).toBeGreaterThan(0);
    }
  });
});
