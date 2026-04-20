import {
  analyzeLighting,
  bucketForBrightness,
  confidenceForBrightness,
  LightingSmoother,
  LIGHTING_THRESHOLDS,
  normalizeHistogram,
} from '@/lib/services/lighting-detector';

describe('lighting-detector / bucketForBrightness', () => {
  it('returns "dark" below dark threshold', () => {
    expect(bucketForBrightness(0)).toBe('dark');
    expect(bucketForBrightness(LIGHTING_THRESHOLDS.dark - 1)).toBe('dark');
  });

  it('returns "dim" between dark and dim thresholds', () => {
    expect(bucketForBrightness(LIGHTING_THRESHOLDS.dark)).toBe('dim');
    expect(bucketForBrightness(LIGHTING_THRESHOLDS.dim - 1)).toBe('dim');
  });

  it('returns "good" at and above the dim threshold', () => {
    expect(bucketForBrightness(LIGHTING_THRESHOLDS.dim)).toBe('good');
    expect(bucketForBrightness(200)).toBe('good');
    expect(bucketForBrightness(255)).toBe('good');
  });

  it('clamps out-of-range and non-finite inputs to "dark" floor', () => {
    expect(bucketForBrightness(-100)).toBe('dark');
    expect(bucketForBrightness(NaN)).toBe('dark');
    // Infinity is non-finite → defensively bucketed as `dark` (safer than `good`).
    expect(bucketForBrightness(Number.POSITIVE_INFINITY)).toBe('dark');
  });
});

describe('lighting-detector / confidenceForBrightness', () => {
  it('returns 0 confidence at the boundary', () => {
    expect(confidenceForBrightness(LIGHTING_THRESHOLDS.dark)).toBe(0);
    expect(confidenceForBrightness(LIGHTING_THRESHOLDS.dim)).toBe(0);
  });

  it('returns higher confidence farther from any boundary', () => {
    const onBoundary = confidenceForBrightness(LIGHTING_THRESHOLDS.dim);
    const farFromBoundary = confidenceForBrightness(200);
    expect(farFromBoundary).toBeGreaterThan(onBoundary);
    expect(farFromBoundary).toBeLessThanOrEqual(1);
  });

  it('saturates at 1 for very dark / very bright extremes', () => {
    expect(confidenceForBrightness(0)).toBe(1);
    expect(confidenceForBrightness(255)).toBe(1);
  });
});

describe('lighting-detector / normalizeHistogram', () => {
  it('returns a zero-filled bin array when histogram is missing', () => {
    expect(normalizeHistogram(undefined)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(normalizeHistogram([])).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('passes through histograms already at the target bin count', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(normalizeHistogram(input)).toEqual(input);
  });

  it('downsamples larger histograms by summing into target bins', () => {
    const input = new Array(16).fill(1);
    const out = normalizeHistogram(input, 4);
    expect(out).toHaveLength(4);
    expect(out.reduce((a, b) => a + b, 0)).toBe(16);
    expect(out.every((v) => v === 4)).toBe(true);
  });

  it('drops negative / non-finite source bins instead of throwing', () => {
    expect(normalizeHistogram([-1, NaN, 5, 0, 0, 0, 0, 0])).toEqual([0, 0, 5, 0, 0, 0, 0, 0]);
  });
});

describe('lighting-detector / analyzeLighting', () => {
  it('handles an all-black sample (brightness 0)', () => {
    const reading = analyzeLighting({ brightness: 0 });
    expect(reading.bucket).toBe('dark');
    expect(reading.confidence).toBe(1);
    expect(reading.histogramBins).toHaveLength(8);
    expect(reading.brightness).toBe(0);
  });

  it('handles an overexposed sample (brightness 255)', () => {
    const reading = analyzeLighting({ brightness: 255 });
    expect(reading.bucket).toBe('good');
    expect(reading.brightness).toBe(255);
  });

  it('exposes the normalized histogram', () => {
    const reading = analyzeLighting({
      brightness: 100,
      histogram: [1, 0, 0, 0, 0, 0, 0, 1],
    });
    expect(reading.histogramBins).toEqual([1, 0, 0, 0, 0, 0, 0, 1]);
  });
});

describe('lighting-detector / LightingSmoother', () => {
  it('returns the median of the rolling window', () => {
    const smoother = new LightingSmoother(3);
    expect(smoother.push(50)).toBe(50);
    expect(smoother.push(100)).toBe(75);
    expect(smoother.push(75)).toBe(75);
    expect(smoother.push(200)).toBe(100);
  });

  it('clamps invalid samples instead of polluting the median', () => {
    const smoother = new LightingSmoother(3);
    smoother.push(50);
    smoother.push(50);
    expect(smoother.push(NaN)).toBe(50);
  });

  it('reset() empties the rolling window', () => {
    const smoother = new LightingSmoother();
    smoother.push(100);
    smoother.reset();
    expect(smoother.push(20)).toBe(20);
  });
});
