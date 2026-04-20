import React from 'react';
import { render } from '@testing-library/react-native';
import { HeartRatePill } from '@/components/form-tracking/HeartRatePill';

describe('HeartRatePill', () => {
  it('renders nothing when bpm is null', () => {
    const { queryByTestId } = render(<HeartRatePill bpm={null} />);
    expect(queryByTestId('heart-rate-pill')).toBeNull();
  });

  it('renders nothing when bpm is zero', () => {
    const { queryByTestId } = render(<HeartRatePill bpm={0} />);
    expect(queryByTestId('heart-rate-pill')).toBeNull();
  });

  it('shows rounded BPM', () => {
    const { getByTestId } = render(<HeartRatePill bpm={132.6} />);
    expect(getByTestId('heart-rate-pill-bpm').props.children).toBe(133);
  });

  it('includes an accessibility label with BPM', () => {
    const { getByTestId } = render(<HeartRatePill bpm={120} />);
    expect(getByTestId('heart-rate-pill').props.accessibilityLabel).toBe(
      'Heart rate 120 beats per minute',
    );
  });

  it('marks stale samples in the accessibility label', () => {
    const now = 1_700_000_000_000;
    const { getByTestId } = render(
      <HeartRatePill bpm={120} timestampMs={now - 60_000} now={() => now} />,
    );
    expect(getByTestId('heart-rate-pill').props.accessibilityLabel).toContain('stale');
  });

  it('picks fatigued zone when bpm is ≥ 85% of maxHR', () => {
    const { getByTestId } = render(<HeartRatePill bpm={170} maxHeartRate={190} />);
    // Structural check: the container border color leaflet should come from fatigued style.
    const node = getByTestId('heart-rate-pill');
    // styles prop is an array of merged style objects.
    const flat = Array.isArray(node.props.style) ? Object.assign({}, ...node.props.style) : node.props.style;
    expect(flat.borderColor).toBe('rgba(255, 110, 110, 0.65)');
  });
});
