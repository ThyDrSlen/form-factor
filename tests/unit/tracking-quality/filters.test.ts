import type { CanonicalJointMap } from '@/lib/pose/types';
import { clampVelocity, filterCoordinates, smoothAngleEMA, smoothCoordinateEMA } from '@/lib/tracking-quality/filters';

function makeMap(entries: Array<[string, { x: number; y: number; isTracked: boolean; confidence?: number }]>) {
  return new Map(entries) as CanonicalJointMap;
}

function getXY(map: CanonicalJointMap, key: string): { x: number; y: number; isTracked: boolean } {
  const joint = map.get(key);
  if (!joint) {
    throw new Error(`Missing joint: ${key}`);
  }
  return joint;
}

describe('tracking-quality filters', () => {
  test('clampVelocity clamps teleport spikes per joint (euclidean)', () => {
    const previous = makeMap([['left_wrist', { x: 0, y: 0, isTracked: true }]]);
    const incoming = makeMap([['left_wrist', { x: 100, y: 0, isTracked: true }]]);

    const clamped = clampVelocity({ previous, incoming, maxDelta: 36, jointKeys: ['left_wrist'] });
    const { x, y, isTracked } = getXY(clamped, 'left_wrist');

    expect(isTracked).toBe(true);
    expect(x).toBeCloseTo(36, 6);
    expect(y).toBeCloseTo(0, 6);

    const originalPrev = getXY(previous, 'left_wrist');
    const originalIncoming = getXY(incoming, 'left_wrist');
    expect(originalPrev).toEqual({ x: 0, y: 0, isTracked: true });
    expect(originalIncoming).toEqual({ x: 100, y: 0, isTracked: true });
  });

  test('filterCoordinates clamps then smooths without teleports across frames', () => {
    const maxDelta = 36;
    const alpha = 0.35;
    const key = 'any_joint_key';
    const target = makeMap([[key, { x: 100, y: 0, isTracked: true }]]);

    let state: CanonicalJointMap | null = makeMap([[key, { x: 0, y: 0, isTracked: true }]]);
    const xs: number[] = [];

    for (let i = 0; i < 4; i++) {
      const next = filterCoordinates({
        previous: state,
        incoming: target,
        maxDelta,
        alpha,
        jointKeys: [key],
      });
      const { x } = getXY(next, key);
      xs.push(x);

      if (state) {
        const prevX = getXY(state, key).x;
        expect(Math.abs(x - prevX)).toBeLessThanOrEqual(maxDelta);
        expect(Math.abs(x - prevX)).toBeLessThanOrEqual(maxDelta * alpha + 1e-9);
      }

      state = next;
    }

    expect(xs[0]).toBeCloseTo(36 * alpha, 6);
    expect(xs[1]).toBeGreaterThan(xs[0]);
    expect(xs[2]).toBeGreaterThan(xs[1]);
    expect(xs[3]).toBeGreaterThan(xs[2]);
    expect(xs[3]).toBeLessThan(100);
  });

  test('smoothCoordinateEMA applies EMA formula on tracked finite joints', () => {
    const previous = makeMap([['k', { x: 0, y: 0, isTracked: true }]]);
    const incoming = makeMap([['k', { x: 10, y: 0, isTracked: true }]]);

    const smoothed = smoothCoordinateEMA({ previous, incoming, alpha: 0.35, jointKeys: ['k'] });
    const { x, y, isTracked } = getXY(smoothed, 'k');

    expect(isTracked).toBe(true);
    expect(x).toBeCloseTo(3.5, 6);
    expect(y).toBeCloseTo(0, 6);
  });

  test('invalid numeric input fails safe (coordinates)', () => {
    const previous = makeMap([['j', { x: 5, y: 6, isTracked: true, confidence: 0.9 }]]);
    const incoming = makeMap([['j', { x: Number.NaN, y: 999, isTracked: true, confidence: 0.1 }]]);

    const clamped = clampVelocity({ previous, incoming, maxDelta: 36, jointKeys: ['j'] });
    const joint = clamped.get('j');
    expect(joint).toBeTruthy();
    expect(joint).toEqual({ x: 5, y: 6, isTracked: false, confidence: 0.1 });
  });

  test('invalid numeric input fails safe (angles)', () => {
    expect(smoothAngleEMA({ previous: 90, incoming: Number.NaN, alpha: 0.24 })).toBe(90);
    expect(smoothAngleEMA({ previous: 90, incoming: Number.POSITIVE_INFINITY, alpha: 0.24 })).toBe(90);
    expect(smoothAngleEMA({ previous: null, incoming: Number.POSITIVE_INFINITY, alpha: 0.24 })).toBeNull();
  });

  test('smoothAngleEMA produces expected EMA values', () => {
    const value = smoothAngleEMA({ previous: 100, incoming: 110, alpha: 0.24 });
    expect(value).toBeCloseTo(102.4, 6);
  });

  // ---------------------------------------------------------------------------
  // NaN / Infinity guards (wave-32 T7)
  // ---------------------------------------------------------------------------

  describe('NaN / Infinity guards', () => {
    test('clampVelocity falls back to prev when incoming.x is +Infinity', () => {
      const previous = makeMap([['j', { x: 10, y: 20, isTracked: true, confidence: 0.9 }]]);
      const incoming = makeMap([['j', { x: Number.POSITIVE_INFINITY, y: 25, isTracked: true, confidence: 0.6 }]]);

      const out = clampVelocity({ previous, incoming, maxDelta: 36, jointKeys: ['j'] });
      const joint = out.get('j');
      expect(joint).toBeTruthy();
      // Incoming is not finite → treated as untracked; previous position held.
      expect(joint?.x).toBe(10);
      expect(joint?.y).toBe(20);
      expect(joint?.isTracked).toBe(false);
    });

    test('clampVelocity falls back to prev when incoming.y is -Infinity', () => {
      const previous = makeMap([['j', { x: 10, y: 20, isTracked: true }]]);
      const incoming = makeMap([['j', { x: 15, y: Number.NEGATIVE_INFINITY, isTracked: true }]]);

      const out = clampVelocity({ previous, incoming, maxDelta: 36, jointKeys: ['j'] });
      const joint = out.get('j');
      expect(joint?.x).toBe(10);
      expect(joint?.y).toBe(20);
      expect(joint?.isTracked).toBe(false);
    });

    test('smoothAngleEMA treats NaN alpha as zero (returns incoming unchanged)', () => {
      // sanitizeAlpha(NaN) → 0 → alpha===0 branch returns next directly.
      const value = smoothAngleEMA({ previous: 100, incoming: 110, alpha: Number.NaN });
      expect(value).toBe(110);
    });

    test('smoothAngleEMA treats Infinity alpha as zero', () => {
      const value = smoothAngleEMA({ previous: 100, incoming: 110, alpha: Number.POSITIVE_INFINITY });
      expect(value).toBe(110);
    });

    test('smoothAngleEMA clamps alpha >1 to exactly 1 (returns incoming)', () => {
      // sanitizeAlpha clamps to [0,1]; alpha=1 means EMA = prev + (next-prev)*1 = next.
      const value = smoothAngleEMA({ previous: 100, incoming: 110, alpha: 5 });
      expect(value).toBe(110);
    });

    test('smoothAngleEMA clamps alpha <0 to exactly 0 (returns incoming unchanged)', () => {
      const value = smoothAngleEMA({ previous: 100, incoming: 110, alpha: -2 });
      expect(value).toBe(110);
    });

    test('smoothCoordinateEMA carries incoming.confidence when prev.confidence is undefined', () => {
      const previous = makeMap([['j', { x: 0, y: 0, isTracked: true }]]); // no confidence
      const incoming = makeMap([['j', { x: 10, y: 0, isTracked: true, confidence: 0.7 }]]);

      const out = smoothCoordinateEMA({ previous, incoming, alpha: 0.5, jointKeys: ['j'] });
      expect(out.get('j')?.confidence).toBe(0.7);
    });

    test('smoothCoordinateEMA falls back to prev.confidence when incoming.confidence is absent', () => {
      const previous = makeMap([['j', { x: 0, y: 0, isTracked: true, confidence: 0.4 }]]);
      const incoming = makeMap([['j', { x: 10, y: 0, isTracked: true }]]); // no confidence
      const out = smoothCoordinateEMA({ previous, incoming, alpha: 0.5, jointKeys: ['j'] });
      expect(out.get('j')?.confidence).toBe(0.4);
    });

    test('smoothCoordinateEMA leaves confidence undefined when neither side has it', () => {
      const previous = makeMap([['j', { x: 0, y: 0, isTracked: true }]]);
      const incoming = makeMap([['j', { x: 10, y: 0, isTracked: true }]]);
      const out = smoothCoordinateEMA({ previous, incoming, alpha: 0.5, jointKeys: ['j'] });
      expect(out.get('j')?.confidence).toBeUndefined();
    });

    test('clampVelocity treats negative maxDelta as zero (no teleport allowed)', () => {
      const previous = makeMap([['j', { x: 10, y: 20, isTracked: true }]]);
      const incoming = makeMap([['j', { x: 30, y: 20, isTracked: true }]]);
      const out = clampVelocity({ previous, incoming, maxDelta: -50, jointKeys: ['j'] });
      const joint = out.get('j');
      // dist > 0, maxDelta clamped to 0 → scale = 0 → x = prev.x + 0 = prev.x
      expect(joint?.x).toBe(10);
      expect(joint?.y).toBe(20);
    });

    test('clampVelocity treats NaN maxDelta as zero', () => {
      const previous = makeMap([['j', { x: 10, y: 20, isTracked: true }]]);
      const incoming = makeMap([['j', { x: 30, y: 20, isTracked: true }]]);
      const out = clampVelocity({ previous, incoming, maxDelta: Number.NaN, jointKeys: ['j'] });
      expect(out.get('j')?.x).toBe(10);
    });
  });
});
