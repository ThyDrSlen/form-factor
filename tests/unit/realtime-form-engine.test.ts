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
