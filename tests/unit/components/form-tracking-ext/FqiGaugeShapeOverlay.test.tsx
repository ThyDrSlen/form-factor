import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'l', Medium: 'm', Heavy: 'h' },
  NotificationFeedbackType: { Success: 's', Warning: 'w', Error: 'e' },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name, testID }: { name: string; testID?: string }) => {
    const React = require('react');
    const { Text } = require('react-native');
    return <Text testID={testID ?? `icon-${name}`}>{name}</Text>;
  },
}));

import { FqiGaugeShapeOverlay } from '@/components/form-tracking-ext/FqiGaugeShapeOverlay';

describe('FqiGaugeShapeOverlay', () => {
  it('renders the check icon for high scores', () => {
    const { getByLabelText } = render(<FqiGaugeShapeOverlay score={92} />);
    const node = getByLabelText(/Form quality 92/);
    expect(node.props.accessibilityLabel).toContain('good');
  });

  it('renders the bar shape for warn scores', () => {
    const { getByLabelText } = render(<FqiGaugeShapeOverlay score={62} />);
    expect(getByLabelText(/Form quality 62/).props.accessibilityLabel).toContain('caution');
  });

  it('renders the dot shape for critical scores', () => {
    const { getByLabelText } = render(<FqiGaugeShapeOverlay score={35} />);
    expect(getByLabelText(/Form quality 35/).props.accessibilityLabel).toContain('critical');
  });
});
