import React from 'react';
import { render } from '@testing-library/react-native';
import { Circle, Line, Rect, Text as SvgText } from 'react-native-svg';
import { SkeletonOverlay } from '@/features/form-tracking/components/SkeletonOverlay';
import type { BodyPose2D } from '@/lib/arkit/ARKitBodyTracker';
import type { DetectionMode } from '@/lib/workouts';

const pose: BodyPose2D = {
  timestamp: 10,
  isTracking: true,
  joints: [
    { name: 'hips_joint', x: 0.5, y: 0.7, isTracked: true },
    { name: 'left_upLeg_joint', x: 0.4, y: 0.7, isTracked: true },
    { name: 'right_upLeg_joint', x: 0.6, y: 0.7, isTracked: true },
    { name: 'left_forearm_joint', x: 0.3, y: 0.4, isTracked: true },
    { name: 'left_hand_joint', x: 0.3, y: 0.6, isTracked: true },
    { name: 'left_leg_joint', x: 0.4, y: 0.85, isTracked: true },
    { name: 'right_toesEnd_joint', x: 0.6, y: 0.95, isTracked: true },
  ],
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('curl frames hips and upper body rather than asking for the full body', () => {
  const view = render(<SkeletonOverlay pose={pose} enabled mode="dumbbell_curl" />);
  expect(view.UNSAFE_getByType(SvgText).props.children).toBe('Hips & arms lane');
  const [box, hipAnchor] = view.UNSAFE_getAllByType(Rect);
  expect(box.props.height).toBeLessThan(0.7);
  expect(hipAnchor.props.y).toBeLessThan(0.8);
  expect(view.UNSAFE_getAllByType(Circle).map(node => [node.props.cx, node.props.cy])).toEqual(
    pose.joints.slice(0, 5).map(joint => [joint.x, joint.y]),
  );
  const bones = view.UNSAFE_getAllByType(Line).filter(node => node.props.stroke !== '#F5D06F');
  expect(bones).toHaveLength(3); // Two hip links and elbow-to-wrist, no lower-leg bone.
});

test.each<[DetectionMode, string]>([
  ['pullup', 'Pull lane'], ['pushup', 'Side lane'], ['benchpress', 'Side lane'],
  ['squat', 'Lift lane'], ['deadlift', 'Lift lane'], ['rdl', 'Full body lane'],
])('%s retains its existing framing lane', (mode, label) => {
  const view = render(<SkeletonOverlay pose={pose} enabled mode={mode} />);
  expect(view.UNSAFE_getByType(SvgText).props.children).toBe(label);
  expect(view.UNSAFE_getAllByType(Circle)).toHaveLength(pose.joints.length);
});
