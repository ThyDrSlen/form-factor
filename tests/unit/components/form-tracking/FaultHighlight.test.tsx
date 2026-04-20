// eslint-disable-next-line @typescript-eslint/no-explicit-any
jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactLib = require('react');
  const createAnimatedComponent = (Component: unknown) => {
    const Wrapped = ReactLib.forwardRef((props: Record<string, unknown>, ref: unknown) =>
      ReactLib.createElement(Component as never, Object.assign({}, props, { ref })),
    );
    Wrapped.displayName = 'AnimatedMock';
    return Wrapped;
  };
  return {
    __esModule: true,
    default: { createAnimatedComponent },
    createAnimatedComponent,
    useSharedValue: (v: number) => ({ value: v }),
    useAnimatedProps: (fn: () => Record<string, unknown>) => fn(),
    withTiming: (v: unknown) => v,
    withSequence: (a: unknown) => a,
    withRepeat: (a: unknown) => a,
    cancelAnimation: () => {},
    Easing: {
      in: (fn: unknown) => fn,
      out: (fn: unknown) => fn,
      quad: (t: number) => t,
    },
  };
});

import React from 'react';
import { render } from '@testing-library/react-native';

import type { Joint2D } from '@/lib/arkit/ARKitBodyTracker';
import {
  FaultHighlight,
  resolveTriggerKey,
  selectFaultJoints,
} from '@/components/form-tracking/FaultHighlight';

function joint(name: string, x = 0.5, y = 0.5, isTracked = true): Joint2D {
  return { name, x, y, isTracked };
}

describe('selectFaultJoints', () => {
  it('returns [] when inputs are missing', () => {
    expect(selectFaultJoints(null, ['left_knee'])).toEqual([]);
    expect(selectFaultJoints([], null)).toEqual([]);
    expect(selectFaultJoints([joint('left_knee')], [])).toEqual([]);
  });

  it('filters to tracked joints whose name is in the fault set', () => {
    const joints: Joint2D[] = [
      joint('left_knee'),
      joint('right_knee'),
      joint('left_hip', 0.4, 0.5, false),
    ];
    const result = selectFaultJoints(joints, ['left_knee', 'left_hip']);
    expect(result.map((j) => j.name)).toEqual(['left_knee']);
  });
});

describe('resolveTriggerKey', () => {
  it('uses explicit trigger when provided', () => {
    expect(resolveTriggerKey(42, ['a'])).toBe('42');
    expect(resolveTriggerKey('rep-5', ['a'])).toBe('rep-5');
  });

  it('derives a stable key from sorted joint names when not provided', () => {
    expect(resolveTriggerKey(undefined, ['b', 'a'])).toBe('a|b');
    expect(resolveTriggerKey(undefined, undefined)).toBe('');
  });
});

describe('<FaultHighlight />', () => {
  it('renders nothing when no fault joints', () => {
    const { toJSON } = render(
      <FaultHighlight
        joints={[joint('left_knee')]}
        faultJointNames={[]}
        width={320}
        height={240}
      />,
    );
    expect(toJSON()).toBeNull();
  });

  it('renders rings for each matching joint', () => {
    const { toJSON } = render(
      <FaultHighlight
        joints={[joint('left_knee'), joint('right_knee')]}
        faultJointNames={['left_knee', 'right_knee']}
        width={320}
        height={240}
      />,
    );
    const json = JSON.stringify(toJSON());
    // jest-expo renders Circle as RNSVGCircle; should see two of them.
    const matches = json.match(/RNSVGCircle/g);
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
