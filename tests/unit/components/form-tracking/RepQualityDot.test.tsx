import React from 'react';
import { render } from '@testing-library/react-native';
import RepQualityDot, { colorForFqi } from '@/components/form-tracking/RepQualityDot';

describe('colorForFqi', () => {
  it('returns teal for high scores', () => {
    expect(colorForFqi(95)).toBe('#3CC8A9');
    expect(colorForFqi(85)).toBe('#3CC8A9');
  });

  it('returns amber for mid scores', () => {
    expect(colorForFqi(84)).toBe('#FFB800');
    expect(colorForFqi(65)).toBe('#FFB800');
  });

  it('returns red for low scores', () => {
    expect(colorForFqi(64)).toBe('#FF4C4C');
    expect(colorForFqi(0)).toBe('#FF4C4C');
  });

  it('returns grey for null or non-finite fqi', () => {
    expect(colorForFqi(null)).toBe('#6B7280');
    expect(colorForFqi(Number.NaN)).toBe('#6B7280');
    expect(colorForFqi(Number.POSITIVE_INFINITY)).toBe('#6B7280');
  });
});

describe('RepQualityDot', () => {
  it('renders with an accessibility label reflecting FQI', () => {
    const { getByLabelText } = render(<RepQualityDot fqi={82} testID="dot" />);
    expect(getByLabelText('Rep FQI 82')).toBeTruthy();
  });

  it('labels the dot as "FQI unavailable" when fqi is null', () => {
    const { getByLabelText } = render(<RepQualityDot fqi={null} />);
    expect(getByLabelText('Rep FQI unavailable')).toBeTruthy();
  });

  it('includes "has faults" in the label when hasFaults is true', () => {
    const { getByLabelText } = render(<RepQualityDot fqi={50} hasFaults />);
    expect(getByLabelText(/has faults/)).toBeTruthy();
  });

  it('includes "occluded" in the label when occluded is true', () => {
    const { getByLabelText } = render(<RepQualityDot fqi={50} occluded />);
    expect(getByLabelText(/occluded/)).toBeTruthy();
  });

  it('honors custom size prop', () => {
    const { getByTestId } = render(<RepQualityDot fqi={90} size={24} testID="dot" />);
    const el = getByTestId('dot');
    expect(el.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: 24, height: 24, borderRadius: 12 })])
    );
  });

  it('applies the fqi color to the dot background', () => {
    const { getByTestId } = render(<RepQualityDot fqi={92} testID="dot" />);
    const el = getByTestId('dot');
    expect(el.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ backgroundColor: '#3CC8A9' })])
    );
  });
});
