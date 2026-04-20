import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import SetReadyButton from '@/components/workout/SetReadyButton';

const mockImpactAsync = jest.fn((_style: string) => Promise.resolve());

jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Medium: 'medium' },
  impactAsync: (style: string) => mockImpactAsync(style),
}));

describe('SetReadyButton', () => {
  beforeEach(() => {
    mockImpactAsync.mockClear();
    mockImpactAsync.mockImplementation(() => Promise.resolve());
  });

  it('renders the default label', () => {
    const onReady = jest.fn();
    const { getByTestId } = render(<SetReadyButton onReady={onReady} />);
    const button = getByTestId('set-ready-button');
    expect(button.props.accessibilityLabel).toBe("I'm ready");
  });

  it('honors a custom label', () => {
    const onReady = jest.fn();
    const { getByTestId } = render(<SetReadyButton onReady={onReady} label="Let's go" />);
    expect(getByTestId('set-ready-button').props.accessibilityLabel).toBe("Let's go");
  });

  it('calls onReady when pressed', async () => {
    const onReady = jest.fn();
    const { getByTestId } = render(<SetReadyButton onReady={onReady} />);
    fireEvent.press(getByTestId('set-ready-button'));
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
  });

  it('triggers a medium-impact haptic on press', async () => {
    const onReady = jest.fn();
    const { getByTestId } = render(<SetReadyButton onReady={onReady} />);
    fireEvent.press(getByTestId('set-ready-button'));
    await waitFor(() => expect(mockImpactAsync).toHaveBeenCalledWith('medium'));
  });

  it('still calls onReady when haptics throw', async () => {
    mockImpactAsync.mockRejectedValueOnce(new Error('unsupported'));
    const onReady = jest.fn();
    const { getByTestId } = render(<SetReadyButton onReady={onReady} />);
    fireEvent.press(getByTestId('set-ready-button'));
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
  });

  it('does not fire when disabled', async () => {
    const onReady = jest.fn();
    const { getByTestId } = render(<SetReadyButton onReady={onReady} disabled={true} />);
    fireEvent.press(getByTestId('set-ready-button'));
    expect(onReady).not.toHaveBeenCalled();
    expect(mockImpactAsync).not.toHaveBeenCalled();
  });

  it('surfaces accessibility disabled state', () => {
    const { getByTestId } = render(
      <SetReadyButton onReady={() => undefined} disabled={true} />,
    );
    expect(getByTestId('set-ready-button').props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });
});
