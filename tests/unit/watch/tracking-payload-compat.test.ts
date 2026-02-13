import { buildWatchTrackingPayload } from '@/lib/watch-connectivity/tracking-payload';

describe('watch tracking payload compatibility', () => {
  test('retains legacy top-level and tracking fields', () => {
    const payload = buildWatchTrackingPayload({
      now: 456,
      isTracking: true,
      mode: 'pullup',
      phase: 'hang',
      reps: 9,
      primaryCue: 'Engage shoulders',
      metrics: { avgElbowDeg: 92.3 },
    });

    expect(payload.isTracking).toBe(true);
    expect(payload.reps).toBe(9);
    expect(payload.tracking.isTracking).toBe(true);
    expect(payload.tracking.mode).toBe('pullup');
    expect(payload.tracking.phase).toBe('hang');
    expect(payload.tracking.reps).toBe(9);
  });
});
