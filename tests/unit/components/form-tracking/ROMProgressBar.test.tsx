import React from 'react';
import { render } from '@testing-library/react-native';

import {
  PHASE_COLORS,
  ROMProgressBar,
  computeFillRect,
} from '@/components/form-tracking/ROMProgressBar';

describe('computeFillRect', () => {
  it('concentric fills left-to-right', () => {
    const r = computeFillRect(0.5, 'concentric', 10, 20, 100, 6);
    expect(r).toEqual({ x: 10, y: 20, width: 50, height: 6 });
  });

  it('eccentric fills right-to-left', () => {
    const r = computeFillRect(0.25, 'eccentric', 10, 20, 100, 6);
    // 100 * (1 - 0.25) = 75 offset, width = 25
    expect(r.x).toBe(85);
    expect(r.width).toBe(25);
  });

  it('clamps progress >1 to 1', () => {
    const r = computeFillRect(1.5, 'concentric', 0, 0, 100, 6);
    expect(r.width).toBe(100);
  });

  it('clamps progress <0 to 0', () => {
    const r = computeFillRect(-0.2, 'concentric', 0, 0, 100, 6);
    expect(r.width).toBe(0);
  });

  it('handles NaN progress as 0', () => {
    const r = computeFillRect(NaN, 'concentric', 0, 0, 100, 6);
    expect(r.width).toBe(0);
  });
});

describe('PHASE_COLORS', () => {
  it('has distinct concentric and eccentric colors', () => {
    expect(PHASE_COLORS.concentric).not.toBe(PHASE_COLORS.eccentric);
  });
});

describe('<ROMProgressBar />', () => {
  const anchor = { name: 'hip', x: 0.5, y: 0.5, isTracked: true };

  it('renders when anchor is tracked', () => {
    const { toJSON } = render(
      <ROMProgressBar
        anchor={anchor}
        progress={0.5}
        phase="concentric"
        width={320}
        height={240}
      />,
    );
    expect(toJSON()).not.toBeNull();
  });

  it('renders nothing when anchor is untracked', () => {
    const { toJSON } = render(
      <ROMProgressBar
        anchor={{ ...anchor, isTracked: false }}
        progress={0.5}
        phase="concentric"
        width={320}
        height={240}
      />,
    );
    expect(toJSON()).toBeNull();
  });
});
