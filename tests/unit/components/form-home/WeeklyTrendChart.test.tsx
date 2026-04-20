import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('react-native-chart-kit', () => {
  const { View } = jest.requireActual('react-native');
  return {
    LineChart: (props: { data: unknown }) => (
      <View testID="mock-line-chart" accessibilityLabel={JSON.stringify(props.data)} />
    ),
  };
});

import { WeeklyTrendChart } from '@/components/form-home/WeeklyTrendChart';

describe('WeeklyTrendChart', () => {
  it('renders an empty state when all points are null', () => {
    const data = [
      { label: 'Mon', avgFqi: null },
      { label: 'Tue', avgFqi: null },
      { label: 'Wed', avgFqi: null },
    ];
    const { getByTestId, getByText } = render(
      <WeeklyTrendChart data={data} p90={null} allTimeAvg={null} />,
    );
    expect(getByTestId('weekly-trend-empty')).toBeTruthy();
    expect(getByText(/No FQI data/)).toBeTruthy();
  });

  it('renders a chart with a dataset when there are values', () => {
    const data = [
      { label: 'Mon', avgFqi: 78 },
      { label: 'Tue', avgFqi: 82 },
      { label: 'Wed', avgFqi: null },
      { label: 'Thu', avgFqi: 88 },
    ];
    const { getByTestId } = render(
      <WeeklyTrendChart data={data} p90={90} allTimeAvg={80} />,
    );
    expect(getByTestId('weekly-trend-chart')).toBeTruthy();
    expect(getByTestId('mock-line-chart')).toBeTruthy();
  });

  it('omits reference lines when p90/allTimeAvg are null', () => {
    const data = [
      { label: 'Mon', avgFqi: 80 },
      { label: 'Tue', avgFqi: 82 },
    ];
    const { getByTestId, queryByText } = render(
      <WeeklyTrendChart data={data} p90={null} allTimeAvg={null} />,
    );
    expect(getByTestId('mock-line-chart')).toBeTruthy();
    // Legend for P90 / Avg should not render.
    expect(queryByText('P90')).toBeNull();
    expect(queryByText('Avg')).toBeNull();
  });
});
