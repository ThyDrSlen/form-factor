import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('moti', () => {
  const { View } = jest.requireActual('react-native');
  return {
    MotiView: View,
    MotiText: View,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  };
});

// eslint-disable-next-line import/first
import TrackingOnboardingOverlay, {
  FORM_TRACKING_ONBOARDING_DISMISSED_KEY,
  // eslint-disable-next-line import/first
} from '../../../../components/form-tracking/TrackingOnboardingOverlay';

describe('TrackingOnboardingOverlay', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('renders the overlay on first load when no dismissal flag is set', async () => {
    const { findByTestId } = render(<TrackingOnboardingOverlay />);
    expect(await findByTestId('tracking-onboarding')).toBeTruthy();
  });

  it('hides once the user dismisses it', async () => {
    const onDismissed = jest.fn();
    const { findByTestId, queryByTestId } = render(
      <TrackingOnboardingOverlay onDismissed={onDismissed} />,
    );

    const node = await findByTestId('tracking-onboarding');
    expect(node).toBeTruthy();

    await act(async () => {
      fireEvent.press(await findByTestId('tracking-onboarding-dismiss'));
    });

    await waitFor(() => {
      expect(queryByTestId('tracking-onboarding')).toBeNull();
    });

    expect(onDismissed).toHaveBeenCalledTimes(1);
    const stored = await AsyncStorage.getItem(FORM_TRACKING_ONBOARDING_DISMISSED_KEY);
    expect(stored).toBe('true');
  });

  it('does not render on the next mount once dismissal is persisted', async () => {
    await AsyncStorage.setItem(FORM_TRACKING_ONBOARDING_DISMISSED_KEY, 'true');
    const { queryByTestId } = render(<TrackingOnboardingOverlay />);

    await waitFor(() => {
      expect(queryByTestId('tracking-onboarding')).toBeNull();
    });
  });

  it('renders even when dismissed if forceVisible is set', async () => {
    await AsyncStorage.setItem(FORM_TRACKING_ONBOARDING_DISMISSED_KEY, 'true');
    const { findByTestId } = render(<TrackingOnboardingOverlay forceVisible />);
    expect(await findByTestId('tracking-onboarding')).toBeTruthy();
  });

  it('collapses the step list when the chevron is tapped', async () => {
    const { findByTestId, queryByText } = render(<TrackingOnboardingOverlay />);
    await findByTestId('tracking-onboarding');

    expect(queryByText('Camera setup')).toBeTruthy();

    await act(async () => {
      fireEvent.press(await findByTestId('tracking-onboarding-collapse'));
    });

    expect(queryByText('Camera setup')).toBeNull();
  });
});
