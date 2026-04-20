import React from 'react';
import { render } from '@testing-library/react-native';
import { ActiveSetBadge } from '@/components/form-tracking/ActiveSetBadge';

describe('ActiveSetBadge', () => {
  it('renders set + exercise when both are provided', () => {
    const { getByTestId, getByText } = render(
      <ActiveSetBadge setLabel="Set 2 of 4" exerciseName="Pull-Ups" />,
    );
    expect(getByTestId('active-set-badge')).toBeTruthy();
    expect(getByText('Set 2 of 4')).toBeTruthy();
    expect(getByText('Pull-Ups')).toBeTruthy();
  });

  it('renders null when setLabel is missing', () => {
    const { queryByTestId } = render(
      <ActiveSetBadge setLabel="" exerciseName="Pull-Ups" />,
    );
    expect(queryByTestId('active-set-badge')).toBeNull();
  });

  it('renders null when exerciseName is missing', () => {
    const { queryByTestId } = render(
      <ActiveSetBadge setLabel="Set 1 of 3" exerciseName="" />,
    );
    expect(queryByTestId('active-set-badge')).toBeNull();
  });

  it('sets an accessibility label combining set + exercise', () => {
    const { getByTestId } = render(
      <ActiveSetBadge setLabel="Set 3 of 5" exerciseName="Squat" />,
    );
    expect(getByTestId('active-set-badge').props.accessibilityLabel).toBe('Set 3 of 5. Squat');
  });
});
