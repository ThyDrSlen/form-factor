import {
  buildWatchTrackingPayload,
  isValidWatchHeartRate,
  isValidWatchTrackingQuality,
  WATCH_PAYLOAD_SCHEMA_VERSION,
} from '@/lib/watch-connectivity/tracking-payload';

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

  describe('backward compatibility', () => {
    it('omits heartRate and quality keys entirely when not provided', () => {
      const payload = buildWatchTrackingPayload({
        now: 1,
        isTracking: false,
        mode: 'squat',
        phase: 'idle',
        reps: 0,
        primaryCue: null,
        metrics: {},
      });

      expect(Object.prototype.hasOwnProperty.call(payload, 'heartRate')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(payload, 'quality')).toBe(false);
      // v stays pinned at 1 for on-wire back-compat
      expect(payload.v).toBe(1);
    });

    it('exposes WATCH_PAYLOAD_SCHEMA_VERSION = 2 (internal schema tracker)', () => {
      expect(WATCH_PAYLOAD_SCHEMA_VERSION).toBe(2);
    });
  });

  describe('heartRate field', () => {
    it('includes valid heartRate when provided (live status)', () => {
      const payload = buildWatchTrackingPayload({
        now: 1000,
        isTracking: true,
        mode: 'pullup',
        phase: 'hang',
        reps: 0,
        primaryCue: null,
        metrics: {},
        heartRate: { bpm: 142, timestamp: 999, status: 'live' },
      });

      expect(payload.heartRate).toEqual({ bpm: 142, timestamp: 999, status: 'live' });
    });

    it('includes valid heartRate when provided (stale status)', () => {
      const payload = buildWatchTrackingPayload({
        now: 2000,
        isTracking: true,
        mode: 'pullup',
        phase: 'hang',
        reps: 2,
        primaryCue: null,
        metrics: {},
        heartRate: { bpm: 130, timestamp: 1500, status: 'stale' },
      });

      expect(payload.heartRate).toEqual({ bpm: 130, timestamp: 1500, status: 'stale' });
    });

    it('includes valid heartRate when provided (unavailable status)', () => {
      const payload = buildWatchTrackingPayload({
        now: 3000,
        isTracking: false,
        mode: 'pullup',
        phase: 'idle',
        reps: 0,
        primaryCue: null,
        metrics: {},
        heartRate: { bpm: 0, timestamp: 0, status: 'unavailable' },
      });

      expect(payload.heartRate?.status).toBe('unavailable');
    });

    it('rejects malformed heartRate with invalid status enum', () => {
      const payload = buildWatchTrackingPayload({
        now: 1,
        isTracking: true,
        mode: 'pullup',
        phase: 'hang',
        reps: 0,
        primaryCue: null,
        metrics: {},
        // @ts-expect-error — intentional invalid shape to exercise validator
        heartRate: { bpm: 140, timestamp: 1, status: 'bogus' },
      });

      expect(payload.heartRate).toBeUndefined();
    });

    it('rejects malformed heartRate with non-numeric bpm', () => {
      const payload = buildWatchTrackingPayload({
        now: 1,
        isTracking: true,
        mode: 'pullup',
        phase: 'hang',
        reps: 0,
        primaryCue: null,
        metrics: {},
        // @ts-expect-error — intentional invalid shape
        heartRate: { bpm: 'fast', timestamp: 1, status: 'live' },
      });

      expect(payload.heartRate).toBeUndefined();
    });
  });

  describe('quality field', () => {
    it('includes valid quality with all fields', () => {
      const payload = buildWatchTrackingPayload({
        now: 1,
        isTracking: true,
        mode: 'squat',
        phase: 'descent',
        reps: 3,
        primaryCue: null,
        metrics: {},
        quality: { trackingConfidence: 0.82, isDegraded: false },
      });

      expect(payload.quality).toEqual({ trackingConfidence: 0.82, isDegraded: false });
    });

    it('includes quality with optional degradationReason', () => {
      const payload = buildWatchTrackingPayload({
        now: 1,
        isTracking: true,
        mode: 'squat',
        phase: 'descent',
        reps: 0,
        primaryCue: null,
        metrics: {},
        quality: { trackingConfidence: 0.3, isDegraded: true, degradationReason: 'occluded' },
      });

      expect(payload.quality).toEqual({
        trackingConfidence: 0.3,
        isDegraded: true,
        degradationReason: 'occluded',
      });
    });

    it('rejects malformed quality with non-boolean isDegraded', () => {
      const payload = buildWatchTrackingPayload({
        now: 1,
        isTracking: true,
        mode: 'squat',
        phase: 'descent',
        reps: 0,
        primaryCue: null,
        metrics: {},
        // @ts-expect-error — intentional invalid shape
        quality: { trackingConfidence: 0.5, isDegraded: 'maybe' },
      });

      expect(payload.quality).toBeUndefined();
    });
  });

  describe('both heartRate and quality together', () => {
    it('includes both when both are valid', () => {
      const payload = buildWatchTrackingPayload({
        now: 500,
        isTracking: true,
        mode: 'pullup',
        phase: 'hang',
        reps: 4,
        primaryCue: 'chin over bar',
        metrics: { avgElbowDeg: 60 },
        heartRate: { bpm: 155, timestamp: 490, status: 'live' },
        quality: { trackingConfidence: 0.91, isDegraded: false },
      });

      expect(payload.heartRate).toBeDefined();
      expect(payload.quality).toBeDefined();
      expect(payload.heartRate?.bpm).toBe(155);
      expect(payload.quality?.trackingConfidence).toBe(0.91);
    });
  });
});

describe('isValidWatchHeartRate', () => {
  it('accepts a correctly-shaped value', () => {
    expect(isValidWatchHeartRate({ bpm: 120, timestamp: 1, status: 'live' })).toBe(true);
  });

  it('rejects null/undefined/primitives', () => {
    expect(isValidWatchHeartRate(null)).toBe(false);
    expect(isValidWatchHeartRate(undefined)).toBe(false);
    expect(isValidWatchHeartRate(120)).toBe(false);
  });

  it('rejects missing fields', () => {
    expect(isValidWatchHeartRate({ bpm: 120, timestamp: 1 })).toBe(false);
  });

  it('rejects NaN/Infinity bpm or timestamp', () => {
    expect(isValidWatchHeartRate({ bpm: NaN, timestamp: 1, status: 'live' })).toBe(false);
    expect(isValidWatchHeartRate({ bpm: 120, timestamp: Infinity, status: 'live' })).toBe(false);
  });
});

describe('isValidWatchTrackingQuality', () => {
  it('accepts a correctly-shaped value', () => {
    expect(isValidWatchTrackingQuality({ trackingConfidence: 0.5, isDegraded: true })).toBe(true);
    expect(
      isValidWatchTrackingQuality({ trackingConfidence: 0.5, isDegraded: true, degradationReason: 'x' }),
    ).toBe(true);
  });

  it('rejects malformed shapes', () => {
    expect(isValidWatchTrackingQuality(null)).toBe(false);
    expect(isValidWatchTrackingQuality({ trackingConfidence: '0.5', isDegraded: true })).toBe(false);
    expect(
      isValidWatchTrackingQuality({ trackingConfidence: 0.5, isDegraded: true, degradationReason: 99 }),
    ).toBe(false);
  });
});
