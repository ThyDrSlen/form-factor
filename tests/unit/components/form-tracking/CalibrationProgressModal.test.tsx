import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('moti', () => {
  const { View } = jest.requireActual('react-native');
  return {
    MotiView: View,
    MotiText: View,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  };
});

// eslint-disable-next-line import/first
import CalibrationProgressModal from '../../../../components/form-tracking/CalibrationProgressModal';

describe('CalibrationProgressModal', () => {
  it('renders nothing when not visible', () => {
    const { queryByTestId } = render(
      <CalibrationProgressModal visible={false} progress={0.5} />,
    );
    expect(queryByTestId('calibration-progress-body')).toBeNull();
  });

  it('renders the progress body and percentage when visible', () => {
    const { getByTestId, getByText } = render(
      <CalibrationProgressModal visible progress={0.42} />,
    );
    expect(getByTestId('calibration-progress-body')).toBeTruthy();
    expect(getByText('42%')).toBeTruthy();
  });

  it('clamps progress values above 1 and below 0', () => {
    const { getByText: getHigh } = render(
      <CalibrationProgressModal visible progress={1.7} />,
    );
    expect(getHigh('100%')).toBeTruthy();

    const { getByText: getLow } = render(
      <CalibrationProgressModal visible progress={-0.3} />,
    );
    expect(getLow('0%')).toBeTruthy();
  });

  it('fires onRecalibrate when the recalibrate button is pressed', () => {
    const onRecalibrate = jest.fn();
    const { getByTestId } = render(
      <CalibrationProgressModal visible progress={0.2} onRecalibrate={onRecalibrate} />,
    );
    fireEvent.press(getByTestId('calibration-recalibrate'));
    expect(onRecalibrate).toHaveBeenCalledTimes(1);
  });

  it('hides the recalibrate button when no handler is provided', () => {
    const { queryByTestId } = render(
      <CalibrationProgressModal visible progress={0.5} />,
    );
    expect(queryByTestId('calibration-recalibrate')).toBeNull();
  });

  it('fires onCancel when the cancel button is pressed', () => {
    const onCancel = jest.fn();
    const { getByTestId } = render(
      <CalibrationProgressModal visible progress={0.25} onCancel={onCancel} />,
    );
    fireEvent.press(getByTestId('calibration-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('exposes a useful accessibilityLabel including the percentage', () => {
    const { getByTestId } = render(
      <CalibrationProgressModal visible progress={0.68} />,
    );
    expect(getByTestId('calibration-progress-body').props.accessibilityLabel).toMatch(
      /68/,
    );
  });
});
