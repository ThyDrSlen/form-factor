import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('moti', () => {
  const { View } = jest.requireActual('react-native');
  return {
    MotiView: View,
    MotiText: View,
  };
});

// eslint-disable-next-line import/first
import { FormQualityBadge } from '@/components/form-tracking/FormQualityBadge';
// eslint-disable-next-line import/first
import { getFqiColor } from '@/components/form-tracking/FqiGauge';

describe('FormQualityBadge', () => {
  it('renders nothing when score is null', () => {
    const { queryByTestId } = render(<FormQualityBadge score={null} />);
    expect(queryByTestId('form-quality-badge')).toBeNull();
  });

  it('renders nothing when score is undefined', () => {
    const { queryByTestId } = render(<FormQualityBadge score={undefined} />);
    expect(queryByTestId('form-quality-badge')).toBeNull();
  });

  it('renders nothing when score is NaN', () => {
    const { queryByTestId } = render(<FormQualityBadge score={Number.NaN} />);
    expect(queryByTestId('form-quality-badge')).toBeNull();
  });

  it('renders a rounded integer score', () => {
    const { getByText } = render(<FormQualityBadge score={82.6} />);
    expect(getByText('83')).toBeTruthy();
  });

  it('clamps scores above 100', () => {
    const { getByText } = render(<FormQualityBadge score={120} />);
    expect(getByText('100')).toBeTruthy();
  });

  it('clamps scores below 0', () => {
    const { getByText } = render(<FormQualityBadge score={-5} />);
    expect(getByText('0')).toBeTruthy();
  });

  it('uses the poor (red) tier color for scores < 40', () => {
    const { getByTestId } = render(<FormQualityBadge score={25} />);
    const badge = getByTestId('form-quality-badge');
    const flat = Array.isArray(badge.props.style)
      ? Object.assign({}, ...badge.props.style.filter(Boolean))
      : badge.props.style;
    expect(flat.borderColor).toBe(getFqiColor(25).fill);
    expect(getFqiColor(25).fill).toBe('#FF3B30');
  });

  it('uses the fair (yellow) tier color for scores 40-69', () => {
    const { getByTestId } = render(<FormQualityBadge score={55} />);
    const badge = getByTestId('form-quality-badge');
    const flat = Array.isArray(badge.props.style)
      ? Object.assign({}, ...badge.props.style.filter(Boolean))
      : badge.props.style;
    expect(flat.borderColor).toBe(getFqiColor(55).fill);
    expect(getFqiColor(55).fill).toBe('#FFC244');
  });

  it('uses the good (green) tier color for scores >= 70', () => {
    const { getByTestId } = render(<FormQualityBadge score={82} />);
    const badge = getByTestId('form-quality-badge');
    const flat = Array.isArray(badge.props.style)
      ? Object.assign({}, ...badge.props.style.filter(Boolean))
      : badge.props.style;
    expect(flat.borderColor).toBe(getFqiColor(82).fill);
    expect(getFqiColor(82).fill).toBe('#3CC8A9');
  });

  it('includes an accessibility label containing the score', () => {
    const { getByTestId } = render(<FormQualityBadge score={82} />);
    expect(getByTestId('form-quality-badge').props.accessibilityLabel).toBe(
      'Form quality 82 out of 100',
    );
  });

  it('honors a custom testID', () => {
    const { getByTestId } = render(<FormQualityBadge score={82} testID="card-badge" />);
    expect(getByTestId('card-badge')).toBeTruthy();
  });
});
