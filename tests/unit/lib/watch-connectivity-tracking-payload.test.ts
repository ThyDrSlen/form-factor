import { buildWatchTrackingPayload } from '@/lib/watch-connectivity/tracking-payload';

describe('buildWatchTrackingPayload', () => {
  it('builds a versioned tracking payload with top-level and nested fields', () => {
    const payload = buildWatchTrackingPayload({
      now: 123,
      isTracking: true,
      mode: 'pullup',
      phase: 'hang',
      reps: 7,
      primaryCue: 'Engage your shoulders',
      metrics: { avgElbowDeg: 88.5, avgShoulderDeg: 101.2, headToHand: null },
    });

    expect(payload).toEqual({
      v: 1,
      type: 'tracking',
      ts: 123,
      isTracking: true,
      reps: 7,
      tracking: {
        isTracking: true,
        mode: 'pullup',
        phase: 'hang',
        reps: 7,
        primaryCue: 'Engage your shoulders',
        metrics: { avgElbowDeg: 88.5, avgShoulderDeg: 101.2, headToHand: null },
      },
    });
  });
});

