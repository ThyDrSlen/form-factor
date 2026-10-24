import React from 'react';
import { act, render } from '@testing-library/react-native';
import { Svg, Circle, Line } from 'react-native-svg';
import { SkeletonOverlay } from '@/features/form-tracking/components/SkeletonOverlay';
import type { BodyPose2D } from '@/lib/arkit/ARKitBodyTracker';

const pose: BodyPose2D = {
  timestamp: 10,
  isTracking: true,
  joints: [
    { name: 'left_forearm_joint', x: 0.2, y: 0.4, isTracked: true },
    { name: 'left_hand_joint', x: 0.3, y: 0.5, isTracked: true },
  ],
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(1000);
});
afterEach(() => jest.useRealTimers());

test('dropout expiry clears drawing without rerendering the surrounding screen', () => {
  const renderScreen = jest.fn();
  function Screen({ frame }: { frame: BodyPose2D }) {
    renderScreen();
    return <SkeletonOverlay pose={frame} enabled mode="pullup" />;
  }
  const { rerender, toJSON } = render(<Screen frame={pose} />);
  expect(toJSON()).not.toBeNull();
  expect(renderScreen).toHaveBeenCalledTimes(1);

  act(() => jest.advanceTimersByTime(20));
  rerender(<Screen frame={{ ...pose, timestamp: 11, joints: [] }} />);
  expect(toJSON()).not.toBeNull();
  expect(renderScreen).toHaveBeenCalledTimes(2);

  act(() => jest.advanceTimersByTime(131));
  expect(toJSON()).toBeNull();
  expect(renderScreen).toHaveBeenCalledTimes(2);
});

test('keeps degraded bones and joints consistent and forwards the SVG capture ref', () => {
  const ref = React.createRef<Svg>();
  const { UNSAFE_getAllByType, unmount } = render(
    <SkeletonOverlay ref={ref} pose={pose} enabled mode="pullup" missingComponents={['rom_score']} />,
  );
  expect(UNSAFE_getAllByType(Circle).map(node => node.props.fill)).toEqual(['#EF4444', '#EF4444']);
  const bone = UNSAFE_getAllByType(Line).find(node => node.props.stroke === '#EF4444');
  expect(bone?.props.strokeWidth).toBe('0.006');
  expect(typeof ref.current?.toDataURL).toBe('function');
  unmount();
  expect(ref.current).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
});

test('stop and exercise changes discard retained geometry', () => {
  const { rerender, toJSON } = render(<SkeletonOverlay pose={pose} enabled mode="pullup" />);
  rerender(<SkeletonOverlay pose={null} enabled={false} mode="pullup" />);
  expect(toJSON()).toBeNull();
  rerender(<SkeletonOverlay pose={pose} enabled mode="pullup" />);
  expect(toJSON()).not.toBeNull();
  rerender(<SkeletonOverlay pose={null} enabled mode="squat" />);
  expect(toJSON()).toBeNull();
});
