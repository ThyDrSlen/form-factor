import React from 'react';
import { render } from '@testing-library/react-native';
import LiveJointConfidenceBadge, {
  tierForConfidence,
} from '@/components/form-tracking/LiveJointConfidenceBadge';

describe('tierForConfidence', () => {
  it('returns unknown for null or NaN confidence', () => {
    expect(tierForConfidence(null)).toBe('unknown');
    expect(tierForConfidence(Number.NaN)).toBe('unknown');
  });

  it('returns critical under the critical threshold', () => {
    expect(tierForConfidence(0.1)).toBe('critical');
    expect(tierForConfidence(0.0)).toBe('critical');
  });

  it('returns warning between critical and warning thresholds', () => {
    expect(tierForConfidence(0.25)).toBe('warning');
    expect(tierForConfidence(0.39)).toBe('warning');
  });

  it('returns good at or above the warning threshold', () => {
    expect(tierForConfidence(0.4)).toBe('good');
    expect(tierForConfidence(0.95)).toBe('good');
  });

  it('respects custom thresholds', () => {
    expect(tierForConfidence(0.55, { warning: 0.6, critical: 0.3 })).toBe('warning');
    expect(tierForConfidence(0.2, { warning: 0.6, critical: 0.3 })).toBe('critical');
  });
});

describe('LiveJointConfidenceBadge', () => {
  it('renders the joint label and percent', () => {
    const { getByText } = render(
      <LiveJointConfidenceBadge joint="left_knee" confidence={0.42} />
    );
    expect(getByText(/L knee confidence 42%/)).toBeTruthy();
  });

  it('handles a right-side joint', () => {
    const { getByText } = render(
      <LiveJointConfidenceBadge joint="right_elbow" confidence={0.8} />
    );
    expect(getByText(/R elbow confidence 80%/)).toBeTruthy();
  });

  it('shows an em-dash when confidence is null', () => {
    const { getByText } = render(
      <LiveJointConfidenceBadge joint="left_knee" confidence={null} />
    );
    expect(getByText(/—/)).toBeTruthy();
  });

  it('omits joint name when joint is null but still shows confidence', () => {
    const { getByText } = render(
      <LiveJointConfidenceBadge joint={null} confidence={0.9} />
    );
    expect(getByText(/Joint confidence 90%/)).toBeTruthy();
  });

  it('uses the warning accent color for warning-tier confidence', () => {
    const { getByTestId } = render(
      <LiveJointConfidenceBadge joint="left_knee" confidence={0.3} testID="badge" />
    );
    const el = getByTestId('badge');
    const styles = Array.isArray(el.props.style) ? el.props.style : [el.props.style];
    const merged = Object.assign({}, ...styles);
    expect(merged.borderColor).toBe('#FFB800');
  });

  it('uses the critical accent color for critical-tier confidence', () => {
    const { getByTestId } = render(
      <LiveJointConfidenceBadge joint="left_knee" confidence={0.1} testID="badge" />
    );
    const el = getByTestId('badge');
    const styles = Array.isArray(el.props.style) ? el.props.style : [el.props.style];
    const merged = Object.assign({}, ...styles);
    expect(merged.borderColor).toBe('#FF4C4C');
  });

  it('uses the good accent color for good-tier confidence', () => {
    const { getByTestId } = render(
      <LiveJointConfidenceBadge joint="left_knee" confidence={0.85} testID="badge" />
    );
    const el = getByTestId('badge');
    const styles = Array.isArray(el.props.style) ? el.props.style : [el.props.style];
    const merged = Object.assign({}, ...styles);
    expect(merged.borderColor).toBe('#3CC8A9');
  });

  it('uses the unknown accent color when confidence is missing', () => {
    const { getByTestId } = render(
      <LiveJointConfidenceBadge joint="left_knee" confidence={null} testID="badge" />
    );
    const el = getByTestId('badge');
    const styles = Array.isArray(el.props.style) ? el.props.style : [el.props.style];
    const merged = Object.assign({}, ...styles);
    expect(merged.borderColor).toBe('#9CA3AF');
  });
});
