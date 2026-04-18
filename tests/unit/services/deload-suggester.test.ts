import {
  suggestDeload,
  type SessionFqiPoint,
} from '@/lib/services/deload-suggester';

function makeSessions(values: readonly (number | null)[]): SessionFqiPoint[] {
  return values.map((avgFqi, idx) => ({
    sessionId: `sess_${idx + 1}`,
    completedAt: new Date(2026, 3, idx + 1).toISOString(),
    avgFqi,
  }));
}

describe('suggestDeload', () => {
  it('returns continue/not_enough_history when history is short', () => {
    const result = suggestDeload(makeSessions([80, 82, 78]));
    expect(result.recommendation).toBe('continue');
    expect(result.reason).toBe('not_enough_history');
    expect(result.suggestedIntensityPct).toBeNull();
  });

  it('ignores null avgFqi when computing history length', () => {
    const result = suggestDeload(makeSessions([80, null, 82, 78]));
    expect(result.reason).toBe('not_enough_history');
  });

  it('returns continue when form is improving', () => {
    const result = suggestDeload(makeSessions([70, 75, 80, 85]));
    expect(result.recommendation).toBe('continue');
    expect(result.reason).toBe('form_stable_or_improving');
  });

  it('returns continue with minor_wobble copy when drop is below threshold', () => {
    // peak 85, latest 84 → 1.2% drop < 8% threshold
    const result = suggestDeload(makeSessions([80, 85, 84, 84]));
    expect(result.recommendation).toBe('continue');
    expect(result.peakToLatestDrop).not.toBeNull();
    expect(result.peakToLatestDrop! < 0.08).toBe(true);
  });

  it('returns hold_intensity when drop exceeds threshold but is not progressive', () => {
    // Window = last 3 = [90, 75, 80]. Peak 90, latest 80 → 11% drop.
    // Not monotonically decreasing (90 → 75 → 80 rebounds) → hold_intensity.
    const result = suggestDeload(makeSessions([80, 82, 90, 75, 80]));
    expect(result.recommendation).toBe('hold_intensity');
    expect(result.reason).toBe('mild_decline');
    expect(result.suggestedIntensityPct).toBe(1);
  });

  it('returns deload_week at 80% when progressive decline exceeds threshold', () => {
    // Window = [90, 82, 78]. Peak 90, latest 78 → 13% drop. Monotonic.
    const result = suggestDeload(makeSessions([80, 85, 90, 82, 78]));
    expect(result.recommendation).toBe('deload_week');
    expect(result.reason).toBe('progressive_decline');
    expect(result.suggestedIntensityPct).toBe(0.8);
  });

  it('returns deload_week at 70% when progressive decline is severe', () => {
    // Peak 90, latest 55 → ~39% drop. 39% >= 16% (2× threshold) → 0.7 intensity.
    const result = suggestDeload(makeSessions([80, 85, 90, 70, 55]));
    expect(result.recommendation).toBe('deload_week');
    expect(result.suggestedIntensityPct).toBe(0.7);
    expect(result.peakToLatestDrop).toBeGreaterThanOrEqual(0.3);
  });

  it('honors custom windowSize and dropThreshold', () => {
    const result = suggestDeload(makeSessions([85, 80, 75, 70]), {
      windowSize: 4,
      dropThreshold: 0.1,
      minSessions: 4,
    });
    expect(result.recommendation).toBe('deload_week');
  });

  it('always attaches a non-empty explanation', () => {
    const cases = [
      makeSessions([80]),
      makeSessions([70, 75, 80, 85]),
      makeSessions([85, 84, 83, 83]),
      makeSessions([90, 85, 80, 75]),
    ];
    for (const sessions of cases) {
      const result = suggestDeload(sessions);
      expect(typeof result.explanation).toBe('string');
      expect(result.explanation.length).toBeGreaterThan(0);
    }
  });
});
