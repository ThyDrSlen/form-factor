import React from 'react';
import { render } from '@testing-library/react-native';

import {
  CueArrowOverlay,
  SEVERITY_COLORS,
  normalizeVector,
} from '@/components/form-tracking/CueArrowOverlay';

describe('normalizeVector', () => {
  it('returns unit vector', () => {
    expect(normalizeVector(3, 4)).toEqual({ x: 0.6, y: 0.8 });
  });

  it('returns zero for zero vector', () => {
    expect(normalizeVector(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('guards against NaN/Infinity', () => {
    expect(normalizeVector(NaN, 1)).toEqual({ x: 0, y: 0 });
    expect(normalizeVector(1, Infinity)).toEqual({ x: 0, y: 0 });
  });
});

describe('SEVERITY_COLORS', () => {
  it('exposes three severities with distinct colors', () => {
    const values = Object.values(SEVERITY_COLORS);
    expect(values).toHaveLength(3);
    expect(new Set(values).size).toBe(3);
  });
});

describe('<CueArrowOverlay />', () => {
  const joint = { name: 'left_knee', x: 0.5, y: 0.5, isTracked: true };

  it('renders arrow geometry (line+arrowhead) when direction is nonzero', () => {
    const { toJSON } = render(
      <CueArrowOverlay
        joint={joint}
        direction={{ x: 1, y: 0 }}
        width={320}
        height={240}
      />,
    );
    const json = JSON.stringify(toJSON());
    // jest-expo mocks Polygon -> RNSVGPath with a `d` attribute. Assert that
    // the SVG tree contains at least a line and a path (arrowhead).
    expect(json).toMatch(/RNSVGLine/);
    expect(json).toMatch(/RNSVGPath/);
  });

  it('renders nothing when joint is untracked', () => {
    const { toJSON } = render(
      <CueArrowOverlay
        joint={{ ...joint, isTracked: false }}
        direction={{ x: 1, y: 0 }}
        width={320}
        height={240}
      />,
    );
    expect(toJSON()).toBeNull();
  });

  it('renders nothing when direction is zero', () => {
    const { toJSON } = render(
      <CueArrowOverlay
        joint={joint}
        direction={{ x: 0, y: 0 }}
        width={320}
        height={240}
      />,
    );
    expect(toJSON()).toBeNull();
  });
});
