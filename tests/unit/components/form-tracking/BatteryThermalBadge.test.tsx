import React from 'react';
import { render } from '@testing-library/react-native';
import { BatteryThermalBadge } from '@/components/form-tracking/BatteryThermalBadge';

describe('<BatteryThermalBadge />', () => {
  it('renders nothing on normal badgeLevel', () => {
    const { toJSON } = render(
      <BatteryThermalBadge badgeLevel="normal" batteryLevel={0.8} thermalState="normal" />
    );
    expect(toJSON()).toBeNull();
  });

  it('renders the warn chip with battery percent when thermal=normal', () => {
    const { getByTestId, getByText } = render(
      <BatteryThermalBadge badgeLevel="warn" batteryLevel={0.15} thermalState="normal" />
    );
    expect(getByTestId('battery-thermal-warn')).toBeTruthy();
    expect(getByText(/Battery 15%/)).toBeTruthy();
  });

  it('prefers thermal copy over battery copy when both are concerning', () => {
    const { getByText } = render(
      <BatteryThermalBadge badgeLevel="warn" batteryLevel={0.5} thermalState="fair" />
    );
    expect(getByText(/Device warm/)).toBeTruthy();
  });

  it('renders the critical chip as a11y alert with assertive live region', () => {
    const { getByTestId, getByText } = render(
      <BatteryThermalBadge badgeLevel="critical" batteryLevel={0.05} thermalState="normal" />
    );
    const node = getByTestId('battery-thermal-critical');
    expect(node.props.accessibilityRole).toBe('alert');
    expect(node.props.accessibilityLiveRegion).toBe('assertive');
    expect(getByText(/Battery 5%/)).toBeTruthy();
  });

  it('uses the thermal label on critical when device is too hot', () => {
    const { getByText } = render(
      <BatteryThermalBadge badgeLevel="critical" batteryLevel={0.8} thermalState="critical" />
    );
    expect(getByText(/Device too hot/)).toBeTruthy();
  });

  it('formats null battery as --%', () => {
    const { getByText } = render(
      <BatteryThermalBadge badgeLevel="warn" batteryLevel={null} thermalState="normal" />
    );
    expect(getByText(/Battery --%/)).toBeTruthy();
  });
});
