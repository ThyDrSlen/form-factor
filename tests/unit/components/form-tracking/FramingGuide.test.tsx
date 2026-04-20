import React from 'react';
import { render } from '@testing-library/react-native';

import type { Joint2D } from '@/lib/arkit/ARKitBodyTracker';
import {
  FramingGuide,
  HINT_MESSAGES,
  computeFramingHint,
} from '@/components/form-tracking/FramingGuide';

function joint(name: string, x: number, y: number, isTracked = true): Joint2D {
  return { name, x, y, isTracked };
}

function frameAt(bx: [number, number], by: [number, number]): Joint2D[] {
  return [
    joint('left_shoulder', bx[0], by[0]),
    joint('right_shoulder', bx[1], by[0]),
    joint('left_hip', bx[0], by[1]),
    joint('right_hip', bx[1], by[1]),
  ];
}

describe('computeFramingHint', () => {
  it('returns not_visible when no joints', () => {
    expect(computeFramingHint(null).hint).toBe('not_visible');
    expect(computeFramingHint([]).hint).toBe('not_visible');
  });

  it('returns not_visible when fewer than 4 tracked joints', () => {
    const joints = [joint('left_shoulder', 0.5, 0.5), joint('right_shoulder', 0.55, 0.5, false)];
    expect(computeFramingHint(joints).hint).toBe('not_visible');
  });

  it('flags too_close when dominant axis is >maxBoxRatio', () => {
    const joints = frameAt([0.05, 0.95], [0.05, 0.95]);
    // Will first hit edge-proximity (too_left), adjust margin to zero.
    expect(computeFramingHint(joints, { edgeMargin: 0 }).hint).toBe('too_close');
  });

  it('flags too_far when dominant axis is <minBoxRatio', () => {
    const joints = frameAt([0.45, 0.55], [0.48, 0.52]);
    expect(computeFramingHint(joints).hint).toBe('too_far');
  });

  it('flags edge-proximity hints before close/far', () => {
    const tooLeft = frameAt([0.01, 0.3], [0.3, 0.6]);
    expect(computeFramingHint(tooLeft).hint).toBe('too_left');

    const tooRight = frameAt([0.7, 0.99], [0.3, 0.6]);
    expect(computeFramingHint(tooRight).hint).toBe('too_right');

    const tooHigh = frameAt([0.3, 0.6], [0.01, 0.5]);
    expect(computeFramingHint(tooHigh).hint).toBe('too_high');

    const tooLow = frameAt([0.3, 0.6], [0.5, 0.99]);
    expect(computeFramingHint(tooLow).hint).toBe('too_low');
  });

  it('returns centered when in ideal range', () => {
    const joints = frameAt([0.3, 0.7], [0.25, 0.75]);
    expect(computeFramingHint(joints).hint).toBe('centered');
  });

  it('message map covers every hint', () => {
    const hints: Array<keyof typeof HINT_MESSAGES> = [
      'centered',
      'too_close',
      'too_far',
      'too_left',
      'too_right',
      'too_high',
      'too_low',
      'not_visible',
    ];
    for (const h of hints) {
      expect(typeof HINT_MESSAGES[h]).toBe('string');
      expect(HINT_MESSAGES[h].length).toBeGreaterThan(0);
    }
  });
});

describe('<FramingGuide />', () => {
  it('renders a hint pill by default with the centered message', () => {
    const joints = frameAt([0.3, 0.7], [0.25, 0.75]);
    const { getByText } = render(
      <FramingGuide joints={joints} width={300} height={400} />,
    );
    expect(getByText(HINT_MESSAGES.centered)).toBeTruthy();
  });

  it('renders not_visible hint when joints are missing', () => {
    const { getByText } = render(
      <FramingGuide joints={null} width={300} height={400} />,
    );
    expect(getByText(HINT_MESSAGES.not_visible)).toBeTruthy();
  });

  it('hides hint pill when hideHint is true', () => {
    const joints = frameAt([0.3, 0.7], [0.25, 0.75]);
    const { queryByText } = render(
      <FramingGuide joints={joints} width={300} height={400} hideHint />,
    );
    expect(queryByText(HINT_MESSAGES.centered)).toBeNull();
  });
});
