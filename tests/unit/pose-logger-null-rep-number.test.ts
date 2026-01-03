import type { PoseSample } from '@/lib/services/pose-logger';
import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';

test('PoseSample supports null repNumber when not in active rep', () => {
  const angles: JointAngles = {
    leftElbow: 90,
    rightElbow: 90,
    leftShoulder: 90,
    rightShoulder: 90,
    leftKnee: 90,
    rightKnee: 90,
    leftHip: 90,
    rightHip: 90,
  };

  const sample: PoseSample = {
    sessionId: 's',
    frameTimestamp: 1,
    exerciseMode: 'pullup',
    phase: 'hang',
    repNumber: null,
    angles,
  };

  expect(sample.repNumber).toBeNull();
});
