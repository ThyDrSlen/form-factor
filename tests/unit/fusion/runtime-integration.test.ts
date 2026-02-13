import { buildFusionWatchPayload } from '@/lib/fusion/runtime-integration';

describe('fusion runtime integration', () => {
  test('publishes_tracking_payload_with_confidence', () => {
    const payload = buildFusionWatchPayload({
      now: 123,
      isTracking: true,
      mode: 'squat',
      phase: 'bottom',
      reps: 4,
      primaryCue: 'Keep chest tall',
      metrics: { leftKnee: 93 },
      fusion: {
        confidence: 0.82,
        degradedMode: false,
      },
    });

    expect(payload.tracking.fusion).toEqual({
      confidence: 0.82,
      degradedMode: false,
    });
    expect(payload.tracking.phase).toBe('bottom');
    expect(payload.reps).toBe(4);
  });
});
