import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import {
  FaultHeatmapThumb,
  type FaultCell,
} from '@/components/form-home/FaultHeatmapThumb';

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

describe('FaultHeatmapThumb', () => {
  it('renders empty state when no cells are supplied', () => {
    const { getByTestId } = render(
      <FaultHeatmapThumb cells={[]} days={days} />,
    );
    expect(getByTestId('fault-heatmap-empty')).toBeTruthy();
  });

  it('limits rows to the top 3 faults by total count', () => {
    const cells: FaultCell[] = [
      { dayLabel: 'Mon', faultId: 'knees_in', count: 5 },
      { dayLabel: 'Tue', faultId: 'knees_in', count: 3 },
      { dayLabel: 'Mon', faultId: 'butt_wink', count: 4 },
      { dayLabel: 'Wed', faultId: 'elbow_flare', count: 6 },
      { dayLabel: 'Tue', faultId: 'heel_lift', count: 2 },
      { dayLabel: 'Mon', faultId: 'lockout_miss', count: 1 },
    ];
    const { getByText, queryByText } = render(
      <FaultHeatmapThumb cells={cells} days={days} />,
    );
    expect(getByText('knees in')).toBeTruthy();
    expect(getByText('butt wink')).toBeTruthy();
    expect(getByText('elbow flare')).toBeTruthy();
    // 4th-5th place faults shouldn't render as rows.
    expect(queryByText('heel lift')).toBeNull();
    expect(queryByText('lockout miss')).toBeNull();
  });

  it('fires onPress when tapped', () => {
    const onPress = jest.fn();
    const cells: FaultCell[] = [
      { dayLabel: 'Mon', faultId: 'knees_in', count: 5 },
    ];
    const { getByTestId } = render(
      <FaultHeatmapThumb cells={cells} days={days} onPress={onPress} />,
    );
    fireEvent.press(getByTestId('fault-heatmap-thumb'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders heat cells for days with faults', () => {
    const cells: FaultCell[] = [
      { dayLabel: 'Mon', faultId: 'knees_in', count: 5 },
      { dayLabel: 'Tue', faultId: 'knees_in', count: 0 },
    ];
    const { getByTestId } = render(
      <FaultHeatmapThumb cells={cells} days={days} />,
    );
    // With max 5, Mon should be at step 4 (fully saturated).
    expect(getByTestId('fault-cell-knees_in-Mon')).toBeTruthy();
    expect(getByTestId('fault-cell-knees_in-Tue')).toBeTruthy();
  });
});
