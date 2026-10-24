import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import { createRealtimeFormEngineState, processRealtimeAngles } from '@/lib/pose/realtime-form-engine';

const baseAngles: JointAngles = {
  leftKnee: 120,
  rightKnee: 121,
  leftElbow: 100,
  rightElbow: 101,
  leftHip: 140,
  rightHip: 141,
  leftShoulder: 90,
  rightShoulder: 91,
};

const allValid = {
  leftKnee: true,
  rightKnee: true,
  leftElbow: true,
  rightElbow: true,
  leftHip: true,
  rightHip: true,
  leftShoulder: true,
  rightShoulder: true,
} as const;

test('realtime form engine smooths and limits unrealistic spikes', () => {
  const state = createRealtimeFormEngineState();
  const first = processRealtimeAngles({
    state,
    angles: baseAngles,
    valid: allValid,
    timestampSec: 1,
  });
  expect(first.angles.leftElbow).toBe(100);

  const second = processRealtimeAngles({
    state,
    angles: { ...baseAngles, leftElbow: 170 },
    valid: allValid,
    timestampSec: 1.02,
  });

  expect(second.angles.leftElbow).toBeLessThan(120);
  expect(second.trackingQuality).toBeGreaterThan(0.95);
});

test('realtime form engine degrades quality with poor visibility and drift', () => {
  const state = createRealtimeFormEngineState();
  processRealtimeAngles({
    state,
    angles: baseAngles,
    valid: allValid,
    timestampSec: 2,
  });

  const degraded = processRealtimeAngles({
    state,
    angles: { ...baseAngles, rightKnee: 135 },
    valid: {
      ...allValid,
      leftKnee: false,
      rightKnee: false,
      leftHip: false,
    },
    timestampSec: 2.04,
    shadowMeanAbsDelta: 24,
  });

  expect(degraded.trackingQuality).toBeLessThan(0.7);
  expect(degraded.alpha).toBeLessThan(0.3);
});

test('realtime form engine recovers when a previously unavailable angle becomes tracked', () => {
  const state = createRealtimeFormEngineState();
  processRealtimeAngles({
    state,
    angles: { ...baseAngles, leftElbow: Number.NaN },
    valid: { ...allValid, leftElbow: false },
    timestampSec: 1,
  });

  const recovered = processRealtimeAngles({
    state,
    angles: baseAngles,
    valid: allValid,
    timestampSec: 1.02,
  });

  expect(recovered.angles.leftElbow).toBe(baseAngles.leftElbow);
  expect(recovered.trackingQuality).toBe(1);
});

describe('unavailable angle recovery', () => {
  const cases = (Object.keys(baseAngles) as (keyof JointAngles)[]).flatMap(key =>
    [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY].map(value => ({ key, value })),
  );

  test.each(cases)('reseeds only $key after an initial $value', ({ key, value }) => {
    const state = createRealtimeFormEngineState();
    processRealtimeAngles({
      state,
      angles: { ...baseAngles, [key]: value },
      valid: { ...allValid, [key]: false },
      timestampSec: 1,
    });

    // A finite but still untracked observation must not become a baseline.
    const unavailable = processRealtimeAngles({
      state,
      angles: baseAngles,
      valid: { ...allValid, [key]: false },
      timestampSec: 1.02,
    });
    expect(unavailable.angles[key]).toBe(value);
    expect(unavailable.trackingQuality).toBeLessThan(1);

    const otherKey = key === 'leftElbow' ? 'rightElbow' : 'leftElbow';
    const recovered = processRealtimeAngles({
      state,
      angles: { ...baseAngles, [otherKey]: baseAngles[otherKey] + 70 },
      valid: allValid,
      timestampSec: 1.04,
    });
    expect(recovered.angles[key]).toBe(baseAngles[key]);
    expect(recovered.trackingQuality).toBe(1);
    expect(recovered.angles[otherKey]).toBeGreaterThan(baseAngles[otherKey]);
    expect(recovered.angles[otherKey]).toBeLessThan(baseAngles[otherKey] + 20);

    // Recovery restores ordinary smoothing, not a permanent bypass.
    const next = processRealtimeAngles({
      state,
      angles: { ...baseAngles, [key]: baseAngles[key] + 70 },
      valid: allValid,
      timestampSec: 1.06,
    });
    expect(next.angles[key]).toBeGreaterThan(baseAngles[key]);
    expect(next.angles[key]).toBeLessThan(baseAngles[key] + 20);
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'preserves an established baseline when a tracked sample is %s', value => {
      const state = createRealtimeFormEngineState();
      processRealtimeAngles({ state, angles: baseAngles, valid: allValid, timestampSec: 1 });
      const invalid = processRealtimeAngles({
        state,
        angles: { ...baseAngles, leftElbow: value },
        valid: allValid,
        timestampSec: 1.02,
      });
      expect(invalid.angles.leftElbow).toBe(baseAngles.leftElbow);
      expect(invalid.trackingQuality).toBeLessThan(1);

      const recovered = processRealtimeAngles({
        state,
        angles: { ...baseAngles, leftElbow: 170 },
        valid: allValid,
        timestampSec: 1.04,
      });
      expect(recovered.angles.leftElbow).toBeGreaterThan(100);
      expect(recovered.angles.leftElbow).toBeLessThan(120);
    },
  );
});
