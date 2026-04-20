import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { AccessiblePressable } from '@/components/a11y/AccessiblePressable';

describe('AccessiblePressable', () => {
  it('auto-expands hitSlop when style is smaller than 44x44', () => {
    const { getByTestId } = render(
      <AccessiblePressable
        testID="btn"
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={{ width: 32, height: 32 }}
      >
        <Text>X</Text>
      </AccessiblePressable>,
    );
    const node = getByTestId('btn');
    expect(node.props.hitSlop).toEqual({ top: 6, bottom: 6, left: 6, right: 6 });
  });

  it('does not override caller-provided hitSlop', () => {
    const { getByTestId } = render(
      <AccessiblePressable
        testID="btn"
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={{ width: 32, height: 32 }}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Text>X</Text>
      </AccessiblePressable>,
    );
    expect(getByTestId('btn').props.hitSlop).toEqual({
      top: 12,
      bottom: 12,
      left: 12,
      right: 12,
    });
  });

  it('skips auto-expansion when the control already meets 44x44', () => {
    const { getByTestId } = render(
      <AccessiblePressable
        testID="btn"
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={{ width: 44, height: 44 }}
      >
        <Text>X</Text>
      </AccessiblePressable>,
    );
    expect(getByTestId('btn').props.hitSlop).toBeUndefined();
  });

  it('respects disableMinHitSlop', () => {
    const { getByTestId } = render(
      <AccessiblePressable
        testID="btn"
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={{ width: 20, height: 20 }}
        disableMinHitSlop
      >
        <Text>X</Text>
      </AccessiblePressable>,
    );
    expect(getByTestId('btn').props.hitSlop).toBeUndefined();
  });
});
