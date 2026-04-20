import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import MobilityDrillCard from '@/components/workout/MobilityDrillCard';
import { getMobilityDrill } from '@/lib/services/mobility-drills';

describe('MobilityDrillCard', () => {
  const drill = getMobilityDrill('hip-90-90');

  it('renders the drill name and description', () => {
    const { getByTestId, getByText } = render(<MobilityDrillCard drill={drill} />);
    expect(getByTestId('mobility-drill-name').props.children).toBe(drill.name);
    expect(getByText(drill.description)).toBeTruthy();
  });

  it('hides steps by default', () => {
    const { queryByTestId } = render(<MobilityDrillCard drill={drill} />);
    expect(queryByTestId('mobility-drill-steps')).toBeNull();
  });

  it('expands to show the step list when toggled', () => {
    const { getByTestId, queryByTestId } = render(<MobilityDrillCard drill={drill} />);
    fireEvent.press(getByTestId('mobility-drill-toggle'));
    expect(queryByTestId('mobility-drill-steps')).not.toBeNull();
  });

  it('honors defaultExpanded=true', () => {
    const { queryByTestId } = render(
      <MobilityDrillCard drill={drill} defaultExpanded={true} />,
    );
    expect(queryByTestId('mobility-drill-steps')).not.toBeNull();
  });

  it('collapses back when toggled twice', () => {
    const { getByTestId, queryByTestId } = render(
      <MobilityDrillCard drill={drill} defaultExpanded={true} />,
    );
    fireEvent.press(getByTestId('mobility-drill-toggle'));
    expect(queryByTestId('mobility-drill-steps')).toBeNull();
  });

  it('flips accessibilityLabel with expansion', () => {
    const { getByTestId } = render(<MobilityDrillCard drill={drill} />);
    const toggle = getByTestId('mobility-drill-toggle');
    expect(toggle.props.accessibilityLabel).toBe('Expand drill steps');
    fireEvent.press(toggle);
    expect(toggle.props.accessibilityLabel).toBe('Collapse drill steps');
  });
});
