import {
  buildNonEmptySensorMatrix,
  classifySensorAvailability,
  selectAlignedSensorFrame,
  TimedSensorBuffer,
} from '@/lib/fusion/sync';

describe('fusion sync and degradation', () => {
  test('drops_stale_frame_when_skew_exceeds_threshold', () => {
    const result = selectAlignedSensorFrame({
      primaryTimestampSec: 10,
      secondaryTimestampSec: 10.51,
      maxTimestampSkewSec: 0.4,
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('stale_frame');
    expect(result.skewSec).toBeCloseTo(0.51, 5);
  });

  test('accepts aligned frame when skew is within threshold', () => {
    const result = selectAlignedSensorFrame({
      primaryTimestampSec: 10,
      secondaryTimestampSec: 10.2,
      maxTimestampSkewSec: 0.4,
    });

    expect(result.accepted).toBe(true);
    expect(result.reason).toBe('aligned');
  });

  test('TimedSensorBuffer returns nearest sample at or before target timestamp', () => {
    const buffer = new TimedSensorBuffer<number>(3);
    buffer.push({ timestampSec: 1, value: 100 });
    buffer.push({ timestampSec: 2, value: 200 });
    buffer.push({ timestampSec: 3, value: 300 });

    const sample = buffer.nearestAtOrBefore(2.4);
    expect(sample).toEqual({ timestampSec: 2, value: 200 });
  });

  test('matrix covers all seven non-empty sensor combinations', () => {
    const matrix = buildNonEmptySensorMatrix();
    expect(matrix).toHaveLength(7);

    const keys = matrix.map((item: { key: string }) => item.key).sort();
    expect(keys).toEqual([
      'airpods',
      'camera',
      'camera+airpods',
      'camera+watch',
      'camera+watch+airpods',
      'watch',
      'watch+airpods',
    ]);
  });

  test('classifies each non-empty sensor state deterministically', () => {
    const matrix = buildNonEmptySensorMatrix();

    for (const entry of matrix) {
      const classification = classifySensorAvailability(entry.presence);
      expect(classification.key).toBe(entry.key);
      expect(classification.mode).toBe(entry.expectedMode);
    }
  });
});
