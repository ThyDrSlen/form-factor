import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { FaultGlossaryChip } from '@/components/form-tracking/FaultGlossaryChip';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

describe('<FaultGlossaryChip />', () => {
  it('renders the glossary display name when entry exists', () => {
    const { getByTestId, getByText } = render(
      <FaultGlossaryChip exerciseId="squat" faultId="knee_valgus" />,
    );
    expect(getByTestId('fault-glossary-chip')).toBeTruthy();
    expect(getByText('Knees Caving In')).toBeTruthy();
  });

  it('falls back to prettified fault id when no entry exists', () => {
    const { getByText, getByTestId } = render(
      <FaultGlossaryChip exerciseId="squat" faultId="mystery_fault" />,
    );
    expect(getByText('Mystery Fault')).toBeTruthy();
    expect(getByTestId('fault-glossary-chip-missing')).toBeTruthy();
  });

  it('calls onPress with the entry details when tapped', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <FaultGlossaryChip
        exerciseId="squat"
        faultId="knee_valgus"
        onPress={onPress}
      />,
    );
    fireEvent.press(getByTestId('fault-glossary-chip-button'));
    expect(onPress).toHaveBeenCalledWith({
      exerciseId: 'squat',
      faultId: 'knee_valgus',
      displayName: 'Knees Caving In',
    });
  });

  it('is not interactive when entry is missing', () => {
    const onPress = jest.fn();
    const { queryByTestId } = render(
      <FaultGlossaryChip
        exerciseId="squat"
        faultId="mystery_fault"
        onPress={onPress}
      />,
    );
    expect(queryByTestId('fault-glossary-chip-button')).toBeNull();
  });
});
