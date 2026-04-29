import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('moti', () => {
  const { View } = jest.requireActual('react-native');
  return {
    MotiView: View,
    MotiText: View,
  };
});

// eslint-disable-next-line import/first
import FqiGauge, { getFqiColor } from '../../../../components/form-tracking/FqiGauge';

describe('FqiGauge', () => {
  it('renders the "--" placeholder when no score is available', () => {
    const { getByTestId, getByText } = render(<FqiGauge score={null} />);
    expect(getByTestId('fqi-gauge')).toBeTruthy();
    expect(getByText('--')).toBeTruthy();
  });

  it('renders the rounded score for a numeric input', () => {
    const { getByText } = render(<FqiGauge score={72.4} />);
    expect(getByText('72')).toBeTruthy();
  });

  it('clamps out-of-range values into the 0-100 band', () => {
    const { getByText: getLow } = render(<FqiGauge score={-5} />);
    expect(getLow('0')).toBeTruthy();

    const { getByText: getHigh } = render(<FqiGauge score={150} />);
    expect(getHigh('100')).toBeTruthy();
  });

  it('exposes a useful accessibilityLabel describing the score', () => {
    const { getByTestId } = render(<FqiGauge score={84} />);
    const node = getByTestId('fqi-gauge');
    expect(node.props.accessibilityLabel).toMatch(/84/);
    expect(node.props.accessibilityLabel).toMatch(/100/);
    expect(node.props.accessibilityRole).toBe('progressbar');
  });

  it('falls back to a neutral label when score is null', () => {
    const { getByTestId } = render(<FqiGauge score={null} />);
    expect(getByTestId('fqi-gauge').props.accessibilityLabel).toMatch(/not yet measured/i);
  });

  it('does not render the info badge when onPress is not provided', () => {
    const { queryByTestId } = render(<FqiGauge score={72} />);
    expect(queryByTestId('fqi-gauge-info-badge')).toBeNull();
  });

  it('renders the info badge and switches to button role when onPress is provided', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(<FqiGauge score={72} onPress={onPress} />);
    const node = getByTestId('fqi-gauge');
    expect(node.props.accessibilityRole).toBe('button');
    expect(node.props.accessibilityHint).toBe('Opens the FQI explainer');
    expect(getByTestId('fqi-gauge-info-badge')).toBeTruthy();
  });

  it('invokes onPress when the gauge is tapped', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(<FqiGauge score={72} onPress={onPress} />);
    fireEvent.press(getByTestId('fqi-gauge'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('keeps the progressbar role when onPress is absent', () => {
    const { getByTestId } = render(<FqiGauge score={50} />);
    expect(getByTestId('fqi-gauge').props.accessibilityRole).toBe('progressbar');
  });

  describe('getFqiColor', () => {
    it('returns red for scores under 40', () => {
      expect(getFqiColor(30).fill).toBe('#FF3B30');
    });

    it('returns yellow for scores between 40 and 69', () => {
      expect(getFqiColor(55).fill).toBe('#FFC244');
    });

    it('returns green for scores 70 and above', () => {
      expect(getFqiColor(85).fill).toBe('#3CC8A9');
    });

    it('returns neutral blue when score is null', () => {
      expect(getFqiColor(null).fill).toBe('#4C8CFF');
    });
  });
});
