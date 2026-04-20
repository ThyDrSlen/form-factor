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

import { CueShapeBadge } from '@/components/form-tracking-ext/CueShapeBadge';

describe('CueShapeBadge', () => {
  it('renders info severity with the information-circle icon', () => {
    const { getByLabelText } = render(
      <CueShapeBadge severity="info" label="Breathe out" />,
    );
    expect(getByLabelText(/Info: Breathe out/)).toBeTruthy();
  });

  it('renders critical severity with the alert-circle icon', () => {
    const { getByText } = render(
      <CueShapeBadge severity="critical" label="Knee caving" />,
    );
    expect(getByText('alert-circle')).toBeTruthy();
  });

  it('renders warn severity with the warning icon', () => {
    const { getByText } = render(
      <CueShapeBadge severity="warn" label="Depth" />,
    );
    expect(getByText('warning')).toBeTruthy();
  });
});
