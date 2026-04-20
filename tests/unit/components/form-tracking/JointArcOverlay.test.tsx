import React from 'react';
import { render } from '@testing-library/react-native';

import {
  JointArcOverlay,
  romColor,
  romProgress,
} from '@/components/form-tracking/JointArcOverlay';

describe('romProgress', () => {
  it('clamps to 0..1', () => {
    expect(romProgress(0, 30, 120)).toBe(0);
    expect(romProgress(200, 30, 120)).toBe(1);
    expect(romProgress(75, 30, 120)).toBeCloseTo(0.5, 2);
  });

  it('returns 0 when range is invalid', () => {
    expect(romProgress(50, 80, 40)).toBe(0);
    expect(romProgress(NaN, 30, 120)).toBe(0);
  });
});

describe('romColor', () => {
  it('green near mid, red at edges', () => {
    expect(romColor(75, 30, 120)).toBe('#22C55E'); // middle
    expect(romColor(30, 30, 120)).toBe('#EF4444'); // edge
    expect(romColor(120, 30, 120)).toBe('#EF4444'); // edge
  });

  it('amber in the middle band', () => {
    expect(romColor(55, 30, 120)).toBe('#F59E0B');
  });
});

describe('<JointArcOverlay />', () => {
  const joint = { name: 'left_elbow', x: 0.5, y: 0.5, isTracked: true };

  it('renders label with rounded degrees by default', () => {
    const { getByText } = render(
      <JointArcOverlay
        activeJoint={joint}
        currentAngle={87.4}
        minROM={30}
        maxROM={120}
        width={320}
        height={240}
      />,
    );
    expect(getByText('87°')).toBeTruthy();
  });

  it('hides label when hideLabel is true', () => {
    const { queryByText } = render(
      <JointArcOverlay
        activeJoint={joint}
        currentAngle={87}
        minROM={30}
        maxROM={120}
        width={320}
        height={240}
        hideLabel
      />,
    );
    expect(queryByText('87°')).toBeNull();
  });

  it('renders nothing when joint is untracked', () => {
    const untracked = { ...joint, isTracked: false };
    const { toJSON } = render(
      <JointArcOverlay
        activeJoint={untracked}
        currentAngle={87}
        minROM={30}
        maxROM={120}
        width={320}
        height={240}
      />,
    );
    expect(toJSON()).toBeNull();
  });
});
