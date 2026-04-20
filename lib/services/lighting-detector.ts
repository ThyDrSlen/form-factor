/**
 * Lighting Detector Service
 *
 * Analyzes per-frame brightness samples (0-255 mean from ARKit pose-logger
 * sample) and emits lighting-quality buckets for the form-tracking UI.
 *
 * Goals:
 * - Pre-rep "lighting too dark" warning prevents form misinterpretation in
 *   low-light gyms / bedrooms.
 * - Detector is decoupled from the native ARKit frame buffer (no Swift edits):
 *   it consumes a precomputed `brightness` mean (0-255) plus an optional
 *   histogram. Callers can be the existing `pose-logger` `lightingScore` field
 *   or any future telemetry pipeline.
 *
 * Bucket thresholds (empirical, conservative):
 *   - `dark` < 40
 *   - `dim`  < 80
 *   - `good` >= 80
 * Overexposure (>= 240) is bucketed `good` (no separate "blown" bucket — UX
 * value of warning users about *too much* light is low).
 */

export type LightingBucket = 'dark' | 'dim' | 'good';

export const LIGHTING_THRESHOLDS = {
  /** Below this mean brightness, bucket = `dark` */
  dark: 40,
  /** Below this mean brightness, bucket = `dim` */
  dim: 80,
  /** Default histogram bin count when caller does not supply one */
  defaultHistogramBins: 8,
} as const;

export interface LightingSample {
  /** Mean per-pixel brightness 0-255 from ARKit/pose-logger sample. */
  brightness: number;
  /** Optional precomputed histogram (length = bin count, sum = pixel count). */
  histogram?: number[];
  /** Optional total pixel count if `histogram` is sparse. Defaults to histogram sum. */
  totalPixels?: number;
}

export interface LightingReading {
  bucket: LightingBucket;
  /**
   * Confidence 0-1 — derived from how far the brightness sits from the nearest
   * bucket boundary. 1.0 = clearly inside bucket; 0.0 = right on the boundary.
   */
  confidence: number;
  /** Histogram bins normalized to a fixed length (defaults to 8). */
  histogramBins: number[];
  /** Mean brightness 0-255 (clamped). */
  brightness: number;
}

/**
 * Clamp a number to a numeric range. Defensive against NaN / Infinity.
 */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/**
 * Convert a raw brightness 0-255 to a lighting bucket.
 */
export function bucketForBrightness(brightness: number): LightingBucket {
  const b = clamp(brightness, 0, 255);
  if (b < LIGHTING_THRESHOLDS.dark) return 'dark';
  if (b < LIGHTING_THRESHOLDS.dim) return 'dim';
  return 'good';
}

/**
 * Compute a 0-1 confidence score for a bucket assignment based on distance
 * from the nearest boundary. Wider gap = higher confidence.
 */
export function confidenceForBrightness(brightness: number): number {
  const b = clamp(brightness, 0, 255);
  // Distance to nearest boundary among {dark, dim, 255-cap}.
  const boundaries = [LIGHTING_THRESHOLDS.dark, LIGHTING_THRESHOLDS.dim];
  let nearest = Number.POSITIVE_INFINITY;
  for (const boundary of boundaries) {
    const d = Math.abs(b - boundary);
    if (d < nearest) nearest = d;
  }
  // Map distance (0..40) to confidence (0..1), saturating at distance 40.
  // 40 = half of the dark bucket width, generous but stable.
  const normalized = clamp(nearest / 40, 0, 1);
  return Number(normalized.toFixed(3));
}

/**
 * Normalize an arbitrary histogram into a fixed bin count. Buckets the input
 * proportionally when the source bin count differs from the target.
 *
 * Edge cases:
 * - Empty / undefined histogram → returns a zero-filled array.
 * - All-zero histogram → returns it as-is.
 * - Source bin count < target → linear duplication-style stretch.
 */
export function normalizeHistogram(
  histogram: number[] | undefined,
  bins: number = LIGHTING_THRESHOLDS.defaultHistogramBins
): number[] {
  const target = Math.max(1, Math.floor(bins));
  if (!histogram || histogram.length === 0) {
    return new Array(target).fill(0);
  }
  if (histogram.length === target) {
    return histogram.map((v) => (Number.isFinite(v) && v >= 0 ? v : 0));
  }
  const out = new Array(target).fill(0);
  const ratio = histogram.length / target;
  for (let i = 0; i < target; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.max(start + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end && j < histogram.length; j += 1) {
      const v = histogram[j];
      if (Number.isFinite(v) && v >= 0) sum += v;
    }
    out[i] = sum;
  }
  return out;
}

/**
 * Analyze a single lighting sample and produce a `LightingReading`.
 *
 * All callers should debounce upstream (see `hooks/use-frame-lighting.ts`) to
 * avoid jittery UI on micro-fluctuations.
 */
export function analyzeLighting(sample: LightingSample): LightingReading {
  const brightness = clamp(sample.brightness, 0, 255);
  const bucket = bucketForBrightness(brightness);
  const confidence = confidenceForBrightness(brightness);
  const histogramBins = normalizeHistogram(sample.histogram);
  return { bucket, confidence, histogramBins, brightness };
}

/**
 * Stateful 3-frame median filter for lighting samples — recommended for
 * subscribers that want a smoother readout without implementing their own
 * debounce logic. (Hooks may use this directly.)
 */
export class LightingSmoother {
  private readonly window: number[] = [];
  private readonly windowSize: number;

  constructor(windowSize = 3) {
    this.windowSize = Math.max(1, Math.floor(windowSize));
  }

  push(brightness: number): number {
    const safe = clamp(brightness, 0, 255);
    this.window.push(safe);
    if (this.window.length > this.windowSize) {
      this.window.shift();
    }
    const sorted = [...this.window].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
  }

  reset(): void {
    this.window.length = 0;
  }
}
