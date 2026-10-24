import { renderHook } from '@testing-library/react-native';
import type { Joint2D } from '@/lib/arkit/ARKitBodyTracker';
import { usePoseOverlay } from '@/features/form-tracking/hooks/use-pose-overlay';

const joint = (name: string): Joint2D => ({ name, x: 0.4, y: 0.5, isTracked: true });
const retainedNames = [
  'root', 'hips_joint', 'left_hip', 'rightHip', 'left_upLeg_joint', 'right_upLeg_joint',
  'left_upper_leg', 'rightUpperLeg', 'spine_4_joint',
  'left_shoulder_1_joint', 'right_shoulder_1_joint', 'left_arm_joint', 'right_arm_joint',
  'left_forearm_joint', 'right_forearm_joint', 'left_hand_joint', 'right_hand_joint',
];

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('curl display-only lower-leg aliases', () => {
  it.each([
    'left_leg_joint', 'RIGHT_LEG_JOINT', 'left_foot_joint', 'right_foot_joint',
    'left_knee', 'rightKnee', 'LEFT_KNEE_JOINT', 'right-knee-joint',
    'left_ankle', 'rightAnkleJoint', 'leftLowerLeg', 'right_lower_leg_joint',
    'left_shin', 'rightCalf', 'leftFoot', 'right_foot_index',
    'left_heel', 'rightHeel', 'left_toes_joint', 'right_toesEnd_joint',
    'leftToe', 'right_toe_1_joint', 'left_big_toe', 'right_small_toe',
  ])('hides %s without hiding hips or arms or mutating sensor joints', (name) => {
    const joints = [...retainedNames, name].map(joint);
    const { result, rerender } = renderHook<Joint2D[], { source: string }>(
      ({ source }) => usePoseOverlay(joints, true, source, 10),
      { initialProps: { source: 'squat' } },
    );
    expect(result.current).toEqual(joints);
    rerender({ source: 'dumbbell_curl' });
    expect(result.current.map(value => value.name)).toEqual(retainedNames);
    expect(joints).toEqual([...retainedNames, name].map(joint));
    rerender({ source: 'deadlift' });
    expect(result.current).toEqual(joints);
  });
});
