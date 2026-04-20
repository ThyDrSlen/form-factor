import React from 'react';
import { render } from '@testing-library/react-native';

import {
  getFqiBucket,
  RepBreakdownList,
  type RepSummary,
} from '@/components/form-tracking/RepBreakdownList';

describe('RepBreakdownList', () => {
  const reps: RepSummary[] = [
    { index: 1, fqi: 88, faults: [] },
    { index: 2, fqi: 55, faults: ['Hips rising', 'Knees caving'] },
    { index: 3, fqi: 22, faults: ['Lost depth', 'Bar drift', 'Foot lift'] },
  ];

  it('renders a row per rep with the correct score label', () => {
    const { getByTestId } = render(<RepBreakdownList reps={reps} />);

    expect(getByTestId('rep-breakdown-list')).toBeTruthy();
    expect(getByTestId('rep-breakdown-row-1')).toBeTruthy();
    expect(getByTestId('rep-breakdown-row-2')).toBeTruthy();
    expect(getByTestId('rep-breakdown-row-3')).toBeTruthy();

    expect(getByTestId('rep-breakdown-score-1').props.children.join('')).toContain('88');
    expect(getByTestId('rep-breakdown-score-2').props.children.join('')).toContain('55');
    expect(getByTestId('rep-breakdown-score-3').props.children.join('')).toContain('22');
  });

  it('colors each row by FQI bucket (>=70 green, 40-69 amber, <40 red)', () => {
    const { getByTestId } = render(<RepBreakdownList reps={reps} />);

    const flatten = (style: unknown) => {
      if (Array.isArray(style)) {
        return style.reduce<Record<string, unknown>>(
          (acc, s) => ({ ...acc, ...(s as Record<string, unknown>) }),
          {},
        );
      }
      return (style as Record<string, unknown>) ?? {};
    };

    const dot1 = flatten(getByTestId('rep-breakdown-dot-1').props.style);
    const dot2 = flatten(getByTestId('rep-breakdown-dot-2').props.style);
    const dot3 = flatten(getByTestId('rep-breakdown-dot-3').props.style);

    expect(dot1.backgroundColor).toBe('#34C759');
    expect(dot2.backgroundColor).toBe('#FFB020');
    expect(dot3.backgroundColor).toBe('#FF4B4B');
  });

  it('renders only the top two faults per rep', () => {
    const { getByTestId, queryByText } = render(<RepBreakdownList reps={reps} />);

    const rep3Chips = getByTestId('rep-breakdown-faults-3');
    expect(rep3Chips).toBeTruthy();

    expect(queryByText('Lost depth')).toBeTruthy();
    expect(queryByText('Bar drift')).toBeTruthy();
    expect(queryByText('Foot lift')).toBeNull();
  });

  it('omits the fault row entirely when a rep has no faults', () => {
    const { queryByTestId } = render(<RepBreakdownList reps={reps} />);
    expect(queryByTestId('rep-breakdown-faults-1')).toBeNull();
  });

  it('renders the empty state when no reps are provided', () => {
    const { getByTestId, getByText } = render(<RepBreakdownList reps={[]} />);

    expect(getByTestId('rep-breakdown-empty')).toBeTruthy();
    expect(getByText(/No reps recorded/i)).toBeTruthy();
  });

  it('respects a custom empty label', () => {
    const { getByText } = render(
      <RepBreakdownList reps={[]} emptyLabel="Nothing to show" />,
    );
    expect(getByText('Nothing to show')).toBeTruthy();
  });

  describe('getFqiBucket', () => {
    it('classifies boundary values correctly', () => {
      expect(getFqiBucket(100)).toBe('good');
      expect(getFqiBucket(70)).toBe('good');
      expect(getFqiBucket(69)).toBe('warn');
      expect(getFqiBucket(40)).toBe('warn');
      expect(getFqiBucket(39)).toBe('bad');
      expect(getFqiBucket(0)).toBe('bad');
    });
  });
});
