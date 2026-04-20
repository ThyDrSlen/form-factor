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
import CueCard, { classifyCue } from '../../../../components/form-tracking/CueCard';

describe('CueCard', () => {
  it('renders nothing when no cue is supplied', () => {
    const { queryByTestId } = render(<CueCard cue={null} />);
    expect(queryByTestId('cue-card')).toBeNull();
  });

  it('renders a critical cue with the correct tag and message', () => {
    const { getByTestId, getByText } = render(
      <CueCard
        cue={{
          message: 'Move into frame — camera cannot detect your body.',
          priority: 'critical',
          faultType: 'visibility',
        }}
      />,
    );
    expect(getByTestId('cue-card').props.accessibilityLabel).toMatch(/CRITICAL/);
    expect(getByText(/cannot detect your body/i)).toBeTruthy();
  });

  it('uses assertive live region for critical cues and polite otherwise', () => {
    const { getByTestId, rerender } = render(
      <CueCard
        cue={{
          message: 'Stop the lift.',
          priority: 'critical',
          faultType: 'generic',
        }}
      />,
    );
    expect(getByTestId('cue-card').props.accessibilityLiveRegion).toBe('assertive');

    rerender(
      <CueCard
        cue={{
          message: 'Go a little deeper.',
          priority: 'warning',
          faultType: 'rom',
        }}
      />,
    );
    expect(getByTestId('cue-card').props.accessibilityLiveRegion).toBe('polite');
  });

  describe('classifyCue', () => {
    it('treats visibility-related messages as critical', () => {
      const cue = classifyCue('Move into the camera frame.');
      expect(cue.priority).toBe('critical');
      expect(cue.faultType).toBe('visibility');
    });

    it('treats range-of-motion cues as warnings', () => {
      const cue = classifyCue('Go deeper on the descent for full ROM.');
      expect(cue.priority).toBe('warning');
      expect(cue.faultType).toBe('rom');
    });

    it('treats tempo cues as warnings', () => {
      const cue = classifyCue('Slow down the eccentric tempo.');
      expect(cue.priority).toBe('warning');
      expect(cue.faultType).toBe('tempo');
    });

    it('treats alignment cues as warnings', () => {
      const cue = classifyCue('Keep your knees tracking over your toes.');
      expect(cue.priority).toBe('warning');
      expect(cue.faultType).toBe('alignment');
    });

    it('falls back to advisory / generic for unmapped text', () => {
      const cue = classifyCue('Nice work — keep breathing.');
      expect(cue.priority).toBe('advisory');
      expect(cue.faultType).toBe('generic');
    });
  });
});
