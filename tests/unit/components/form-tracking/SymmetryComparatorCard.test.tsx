import React from 'react';
import { render } from '@testing-library/react-native';
import {
  SymmetryComparatorCard,
} from '@/components/form-tracking/SymmetryComparatorCard';
import type { SymmetryDatum } from '@/hooks/use-symmetry-comparison';

const SAMPLE_SERIES: SymmetryDatum[] = [
  { repNumber: 1, leftAngleDeg: 100, rightAngleDeg: 90, asymmetryPct: 10 },
  { repNumber: 2, leftAngleDeg: 110, rightAngleDeg: 80, asymmetryPct: 27.27 },
  { repNumber: 3, leftAngleDeg: 95, rightAngleDeg: 95, asymmetryPct: 0 },
];

describe('<SymmetryComparatorCard />', () => {
  it('renders the empty-state message when fallback is true', () => {
    const { getByTestId } = render(<SymmetryComparatorCard series={[]} isFallback />);
    expect(getByTestId('symmetry-comparator-empty')).toBeTruthy();
  });

  it('renders a not-enough-data message when no fallback flag is set', () => {
    const { getByTestId } = render(<SymmetryComparatorCard series={[]} />);
    expect(getByTestId('symmetry-comparator-empty').props.children).toMatch(
      /Not enough valid bilateral data/i
    );
  });

  it('renders the loading state', () => {
    const { getByText } = render(<SymmetryComparatorCard series={[]} isLoading />);
    expect(getByText(/Loading rep history/i)).toBeTruthy();
  });

  it('renders the chart + summary when series has valid data', () => {
    const { getByTestId, getByText } = render(
      <SymmetryComparatorCard series={SAMPLE_SERIES} />
    );
    expect(getByTestId('symmetry-comparator-card')).toBeTruthy();
    expect(getByText(/Peak asymmetry/i)).toBeTruthy();
    expect(getByText(/27\.3%/)).toBeTruthy();
  });

  it('filters out NaN/null asymmetryPct datapoints before charting', () => {
    const series: SymmetryDatum[] = [
      ...SAMPLE_SERIES,
      { repNumber: 4, leftAngleDeg: 0, rightAngleDeg: 90, asymmetryPct: null },
    ];
    // Should still render chart from the 3 valid datapoints.
    const { queryByTestId } = render(<SymmetryComparatorCard series={series} />);
    expect(queryByTestId('symmetry-comparator-empty')).toBeNull();
  });

  it('always shows the threshold legend', () => {
    const { getByText } = render(<SymmetryComparatorCard series={SAMPLE_SERIES} />);
    expect(getByText(/15% threshold/)).toBeTruthy();
  });
});
