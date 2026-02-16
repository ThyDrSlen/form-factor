jest.mock('@/lib/logger', () => ({
  errorWithTs: jest.fn(),
  logWithTs: jest.fn(),
  warnWithTs: jest.fn(),
}));

import { BodyTracker, type BodyPose } from '@/lib/arkit/ARKitBodyTracker.ios';

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
}));

describe('ARKit BodyTracker.findJoint', () => {
  test('normalizes neck lookup to avoid side-biased back-facing drift (RED)', () => {
    const pose: BodyPose = {
      timestamp: 1,
      isTracking: true,
      joints: [
        { name: 'neck_1_joint', x: 0.45, y: 0.2, z: 0, isTracked: true },
        { name: 'neck_4_joint', x: 0.62, y: 0.2, z: 0, isTracked: true },
      ],
    };

    const neck = BodyTracker.findJoint(pose, 'neck');
    expect(neck?.x).toBeCloseTo((0.45 + 0.62) / 2, 6);
  });
});
