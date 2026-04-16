import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import FormTrackingSettingsModal from '../../../app/(modals)/form-tracking-settings';
import { __clearListenersForTests } from '@/hooks/use-form-tracking-settings';
import {
  DEFAULT_FORM_TRACKING_SETTINGS,
  __resetForTests,
  loadSettings,
} from '@/lib/services/form-tracking-settings';

jest.mock('@/hooks/use-safe-back', () => ({
  useSafeBack: () => jest.fn(),
}));

describe('FormTrackingSettingsModal', () => {
  beforeEach(async () => {
    await __resetForTests();
    __clearListenersForTests();
  });

  it('renders all sections and the reset button', async () => {
    const { getByText, getByTestId } = render(<FormTrackingSettingsModal />);
    await waitFor(() => expect(getByTestId('ft-settings-scroll')).toBeTruthy());

    expect(getByText('Form quality')).toBeTruthy();
    expect(getByText('Feedback')).toBeTruthy();
    expect(getByText('Display')).toBeTruthy();
    expect(getByText('Session')).toBeTruthy();
    expect(getByText('Per-exercise overrides')).toBeTruthy();
    expect(getByTestId('ft-settings-reset')).toBeTruthy();
  });

  it('increments FQI threshold by one step when the + button is pressed', async () => {
    const { getByTestId } = render(<FormTrackingSettingsModal />);
    await waitFor(() => expect(getByTestId('ft-settings-scroll')).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId('ft-settings-fqi-inc'));
    });

    await waitFor(async () => {
      const loaded = await loadSettings();
      expect(loaded.fqiThreshold).toBeGreaterThan(DEFAULT_FORM_TRACKING_SETTINGS.fqiThreshold);
    });
  });

  it('updates cue verbosity when segment is tapped', async () => {
    const { getByTestId } = render(<FormTrackingSettingsModal />);
    await waitFor(() => expect(getByTestId('ft-settings-scroll')).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId('ft-settings-verbosity-detailed'));
    });

    await waitFor(async () => {
      const loaded = await loadSettings();
      expect(loaded.cueVerbosity).toBe('detailed');
    });
  });

  it('toggles haptics off via the switch', async () => {
    const { getByTestId } = render(<FormTrackingSettingsModal />);
    await waitFor(() => expect(getByTestId('ft-settings-scroll')).toBeTruthy());

    const switchEl = getByTestId('ft-settings-haptics-switch');
    await act(async () => {
      fireEvent(switchEl, 'valueChange', false);
    });

    await waitFor(async () => {
      const loaded = await loadSettings();
      expect(loaded.hapticsEnabled).toBe(false);
    });
  });

  it('reset button restores defaults', async () => {
    const { getByTestId } = render(<FormTrackingSettingsModal />);
    await waitFor(() => expect(getByTestId('ft-settings-scroll')).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId('ft-settings-fqi-inc'));
    });
    await act(async () => {
      fireEvent.press(getByTestId('ft-settings-reset'));
    });

    await waitFor(async () => {
      const loaded = await loadSettings();
      expect(loaded.fqiThreshold).toBe(DEFAULT_FORM_TRACKING_SETTINGS.fqiThreshold);
    });
  });
});
