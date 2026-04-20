import React, { useState } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Provider as PaperProvider } from 'react-native-paper';

import { CoachRoutingPreference } from '@/components/settings/CoachRoutingPreference';
import type { CoachRoutingPreference as RoutingPref } from '@/lib/services/coach-dispatch';

function Harness({
  initial = 'cloud_only',
  localDisabled = false,
  onChange,
}: {
  initial?: RoutingPref;
  localDisabled?: boolean;
  onChange?: (next: RoutingPref) => void;
}) {
  const [value, setValue] = useState<RoutingPref>(initial);
  return (
    <PaperProvider>
      <CoachRoutingPreference
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
        localDisabled={localDisabled}
      />
    </PaperProvider>
  );
}

describe('CoachRoutingPreference', () => {
  it('renders all three options with radiogroup role', () => {
    const { getByTestId } = render(<Harness />);
    expect(getByTestId('coach-routing-preference')).toBeTruthy();
    expect(getByTestId('coach-routing-preference-cloud_only')).toBeTruthy();
    expect(getByTestId('coach-routing-preference-prefer_local')).toBeTruthy();
    expect(getByTestId('coach-routing-preference-local_only')).toBeTruthy();
  });

  it('toggles selection when a different option is pressed', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(<Harness onChange={onChange} />);

    const preferLocalRow = getByTestId('coach-routing-preference-prefer_local');
    // The RadioButton inside the row is a pressable; pressing the row
    // itself in tests routes to onValueChange via RN Paper.
    fireEvent.press(preferLocalRow);
    expect(onChange).toHaveBeenCalledWith('prefer_local');
    expect(preferLocalRow.props.accessibilityState.checked).toBe(true);
  });

  it('marks local_only accessibilityState.disabled when localDisabled=true', () => {
    const { getByTestId } = render(<Harness localDisabled />);
    const localOnlyRow = getByTestId('coach-routing-preference-local_only');
    expect(localOnlyRow.props.accessibilityState.disabled).toBe(true);
  });

  it('reflects external value changes in accessibility state', () => {
    const { getByTestId, rerender } = render(
      <PaperProvider>
        <CoachRoutingPreference value="cloud_only" onChange={jest.fn()} />
      </PaperProvider>,
    );
    expect(getByTestId('coach-routing-preference-cloud_only').props.accessibilityState.checked).toBe(true);

    rerender(
      <PaperProvider>
        <CoachRoutingPreference value="local_only" onChange={jest.fn()} />
      </PaperProvider>,
    );
    expect(getByTestId('coach-routing-preference-local_only').props.accessibilityState.checked).toBe(true);
    expect(getByTestId('coach-routing-preference-cloud_only').props.accessibilityState.checked).toBe(false);
  });
});
