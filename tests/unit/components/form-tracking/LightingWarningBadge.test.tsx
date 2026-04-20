import React from 'react';
import { render } from '@testing-library/react-native';
import { LightingWarningBadge } from '@/components/form-tracking/LightingWarningBadge';

describe('<LightingWarningBadge />', () => {
  it('renders nothing when bucket is "good"', () => {
    const { toJSON } = render(<LightingWarningBadge bucket="good" />);
    expect(toJSON()).toBeNull();
  });

  it('renders nothing when bucket is null', () => {
    const { toJSON } = render(<LightingWarningBadge bucket={null} />);
    expect(toJSON()).toBeNull();
  });

  it('renders the "Low light" chip on dim bucket with a polite live region', () => {
    const { getByTestId, getByText } = render(<LightingWarningBadge bucket="dim" />);
    expect(getByText('Low light')).toBeTruthy();
    const node = getByTestId('lighting-warning-dim');
    expect(node.props.accessibilityRole).toBe('text');
    expect(node.props.accessibilityLiveRegion).toBe('polite');
  });

  it('renders the "Lighting too dark" chip on dark bucket as an a11y alert', () => {
    const { getByTestId, getByText } = render(<LightingWarningBadge bucket="dark" />);
    expect(getByText('Lighting too dark')).toBeTruthy();
    const node = getByTestId('lighting-warning-dark');
    expect(node.props.accessibilityRole).toBe('alert');
    expect(node.props.accessibilityLiveRegion).toBe('assertive');
    expect(node.props.accessibilityLabel).toBe('Lighting too dark');
  });

  it('respects an explicit testID override', () => {
    const { getByTestId } = render(
      <LightingWarningBadge bucket="dark" testID="custom-test-id" />
    );
    expect(getByTestId('custom-test-id')).toBeTruthy();
  });
});
