import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import { createRealtimeFormEngineState, processRealtimeAngles } from '@/lib/pose/realtime-form-engine';
import { processTrackingQualityAngles } from '@/lib/tracking-quality';

const baseAngles: JointAngles = {
  leftKnee: 120, rightKnee: 121,
  leftElbow: 100, rightElbow: 101,
  leftHip: 140, rightHip: 141,
  leftShoulder: 90, rightShoulder: 91,
};
const allValid = {
  leftKnee: true, rightKnee: true,
  leftElbow: true, rightElbow: true,
  leftHip: true, rightHip: true,
  leftShoulder: true, rightShoulder: true,
};
const keys = Object.keys(baseAngles) as (keyof JointAngles)[];
const cases = keys.flatMap(key => [Number.NaN, Infinity, -Infinity].map(value => ({ key, value })));

describe.each([
  ['direct', processRealtimeAngles],
  ['tracking quality', processTrackingQualityAngles],
] as const)('%s smoothing recovery', (_name, processAngles) => {
  test.each(cases)('recovers $key from $value only after a tracked finite sample', ({ key, value }) => {
    const state = createRealtimeFormEngineState();
    const otherKey = key === 'leftElbow' ? 'rightElbow' : 'leftElbow';
    processAngles({
      state,
      angles: { ...baseAngles, [key]: value },
      valid: { ...allValid, [key]: false },
      timestampSec: 1,
    });

    // Finite data alone must not restore an untracked joint.
    const stillUntracked = processAngles({
      state, angles: baseAngles,
      valid: { ...allValid, [key]: false },
      timestampSec: 1.02,
    });
    expect(stillUntracked.angles[key]).toBe(value);
    expect(stillUntracked.trackingQuality).toBeLessThan(1);

    const recovered = processAngles({
      state,
      angles: { ...baseAngles, [otherKey]: baseAngles[otherKey] + 70 },
      valid: allValid,
      timestampSec: 1.04,
    });
    expect(recovered.angles[key]).toBe(baseAngles[key]);
    expect(recovered.trackingQuality).toBe(1);
    // Recovery must not reset smoothing for unrelated, already tracked joints.
    expect(recovered.angles[otherKey]).toBeGreaterThan(baseAngles[otherKey]);
    expect(recovered.angles[otherKey]).toBeLessThan(baseAngles[otherKey] + 70);

    const next = processAngles({
      state, angles: { ...baseAngles, [key]: baseAngles[key] + 20 },
      valid: allValid,
      timestampSec: 1.06,
    });
    expect(next.angles[key]).toBeGreaterThan(baseAngles[key]);
    expect(next.angles[key]).toBeLessThan(baseAngles[key] + 20);

    // A later bad measurement must not poison a recovered finite baseline,
    // even when the provider incorrectly labels the measurement tracked.
    const dropped = processAngles({
      state, angles: { ...baseAngles, [key]: Number.NaN },
      valid: allValid,
      timestampSec: 1.08,
    });
    expect(dropped.angles[key]).toBe(next.angles[key]);
    expect(dropped.trackingQuality).toBeLessThan(1);
  });

  test('curl recovery does not require unavailable knees to recover', () => {
    const state = createRealtimeFormEngineState();
    const angles = { ...baseAngles, leftKnee: Number.NaN, rightKnee: Number.NaN };
    const valid = { ...allValid, leftKnee: false, rightKnee: false };
    processAngles({
      state,
      angles: { ...angles, leftElbow: Number.NaN },
      valid: { ...valid, leftElbow: false },
      timestampSec: 1,
      workoutId: 'dumbbell_curl',
    });
    const recovered = processAngles({
      state, angles, valid, timestampSec: 1.02, workoutId: 'dumbbell_curl',
    });
    expect(recovered.angles.leftElbow).toBe(baseAngles.leftElbow);
    expect(recovered.angles.leftKnee).toBeNaN();
    expect(recovered.angles.rightKnee).toBeNaN();
    expect(recovered.trackingQuality).toBe(1);
  });
});
