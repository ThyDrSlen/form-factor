import React from 'react';
import { render } from '@testing-library/react-native';

import { SessionHighlightCard } from '@/components/form-tracking/SessionHighlightCard';
import type { RepSummary } from '@/components/form-tracking/RepBreakdownList';

describe('SessionHighlightCard', () => {
  const best: RepSummary = { index: 4, fqi: 92, faults: [] };
  const worst: RepSummary = { index: 2, fqi: 35, faults: ['Hips rising'] };

  it('renders both cards with indexes, scores, and fault text', () => {
    const { getByTestId } = render(
      <SessionHighlightCard best={best} worst={worst} />,
    );

    expect(getByTestId('session-highlight-row')).toBeTruthy();

    expect(getByTestId('session-highlight-best-rep-index').props.children.join('')).toContain(
      '4',
    );
    expect(getByTestId('session-highlight-best-score').props.children.join('')).toContain('92');

    expect(getByTestId('session-highlight-worst-rep-index').props.children.join('')).toContain(
      '2',
    );
    expect(getByTestId('session-highlight-worst-fault').props.children).toBe('Hips rising');
  });

  it('falls back to placeholder text when best is missing', () => {
    const { getByTestId, queryByTestId } = render(
      <SessionHighlightCard worst={worst} />,
    );

    expect(getByTestId('session-highlight-best-empty')).toBeTruthy();
    expect(queryByTestId('session-highlight-best-score')).toBeNull();
    expect(queryByTestId('session-highlight-best-rep-index')).toBeNull();
    expect(getByTestId('session-highlight-worst-rep-index')).toBeTruthy();
  });

  it('falls back to placeholder text when worst is missing', () => {
    const { getByTestId, queryByTestId } = render(
      <SessionHighlightCard best={best} />,
    );

    expect(getByTestId('session-highlight-worst-empty')).toBeTruthy();
    expect(queryByTestId('session-highlight-worst-rep-index')).toBeNull();
    expect(getByTestId('session-highlight-best-rep-index')).toBeTruthy();
  });

  it('renders empty states on both cards when no reps are provided', () => {
    const { getByTestId } = render(<SessionHighlightCard />);
    expect(getByTestId('session-highlight-best-empty')).toBeTruthy();
    expect(getByTestId('session-highlight-worst-empty')).toBeTruthy();
  });

  it('exposes accessibility labels that describe the card contents', () => {
    const { getByTestId } = render(
      <SessionHighlightCard best={best} worst={worst} />,
    );

    expect(getByTestId('session-highlight-best').props.accessibilityLabel).toBe(
      'Best rep 4, FQI 92',
    );
    expect(getByTestId('session-highlight-worst').props.accessibilityLabel).toBe(
      'Needs work: rep 2, top fault Hips rising',
    );
  });

  it('uses a generic fault label when the worst rep has no named faults', () => {
    const worstNoFaults: RepSummary = { index: 3, fqi: 30, faults: [] };
    const { getByTestId } = render(
      <SessionHighlightCard best={best} worst={worstNoFaults} />,
    );

    expect(getByTestId('session-highlight-worst-fault').props.children).toBe('Form dip');
  });
});
