import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import {
  buildCanonicalJointMapFromMediaPipeLandmarks,
  buildMediaPipeShadowFrameFromLandmarks,
  MEDIAPIPE_POSE_LANDMARKER_VERSION,
  type MediaPipeLandmark2D,
} from '@/lib/pose/adapters/mediapipe-workout-adapter';

const primaryAngles: JointAngles = {
  leftKnee: 120,
  rightKnee: 121,
  leftElbow: 100,
  rightElbow: 101,
  leftHip: 140,
  rightHip: 141,
  leftShoulder: 90,
  rightShoulder: 91,
};

function makeLandmarks(): MediaPipeLandmark2D[] {
  const landmarks: MediaPipeLandmark2D[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  landmarks[0] = { x: 0.5, y: 0.2, visibility: 1 }; // nose
  landmarks[11] = { x: 0.42, y: 0.3, visibility: 1 }; // left shoulder
  landmarks[12] = { x: 0.58, y: 0.3, visibility: 1 }; // right shoulder
  landmarks[13] = { x: 0.35, y: 0.42, visibility: 1 }; // left elbow
  landmarks[14] = { x: 0.65, y: 0.42, visibility: 1 }; // right elbow
  landmarks[15] = { x: 0.3, y: 0.55, visibility: 1 }; // left wrist
  landmarks[16] = { x: 0.7, y: 0.55, visibility: 1 }; // right wrist
  landmarks[23] = { x: 0.46, y: 0.52, visibility: 1 }; // left hip
  landmarks[24] = { x: 0.54, y: 0.52, visibility: 1 }; // right hip
  landmarks[25] = { x: 0.44, y: 0.7, visibility: 1 }; // left knee
  landmarks[26] = { x: 0.56, y: 0.7, visibility: 1 }; // right knee
  landmarks[27] = { x: 0.42, y: 0.9, visibility: 1 }; // left ankle
  landmarks[28] = { x: 0.58, y: 0.9, visibility: 1 }; // right ankle
  return landmarks;
}

test('buildCanonicalJointMapFromMediaPipeLandmarks maps workout aliases', () => {
  const map = buildCanonicalJointMapFromMediaPipeLandmarks({ landmarks: makeLandmarks() });

  expect(map.get('left_shoulder')?.x).toBeCloseTo(0.42, 6);
  expect(map.get('left_forearm')?.x).toBeCloseTo(0.35, 6);
  expect(map.get('left_upleg')?.x).toBeCloseTo(0.46, 6);
  expect(map.get('spine')?.isTracked).toBe(true);
  expect(map.get('neck')?.isTracked).toBe(true);
});

test('buildMediaPipeShadowFrameFromLandmarks emits mediapipe provider metadata', () => {
  const frame = buildMediaPipeShadowFrameFromLandmarks({
    primaryAngles,
    landmarks: makeLandmarks(),
    timestamp: 1234,
    inferenceMs: 12,
  });

  expect(frame.provider).toBe('mediapipe');
  expect(frame.modelVersion).toBe(MEDIAPIPE_POSE_LANDMARKER_VERSION);
  expect(frame.timestamp).toBe(1234);
  expect(frame.comparedJoints).toBe(8);
  expect(frame.coverageRatio).toBeCloseTo(1, 6);
});

test('buildCanonicalJointMapFromMediaPipeLandmarks honors visibility threshold', () => {
  const landmarks = makeLandmarks();
  landmarks[11] = { ...landmarks[11], visibility: 0.2 };
  const map = buildCanonicalJointMapFromMediaPipeLandmarks({
    landmarks,
    visibilityThreshold: 0.5,
  });

  expect(map.has('left_shoulder')).toBe(false);
  expect(map.has('left_forearm')).toBe(true);
});
