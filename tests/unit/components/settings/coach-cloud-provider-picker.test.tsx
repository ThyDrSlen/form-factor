import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@/lib/services/coach-cloud-provider', () => ({
  resolveCloudProvider: jest.fn(),
  setCloudProviderPreference: jest.fn(),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: (props: { accessibilityLabel?: string }) => {
    const { Text } = require('react-native');
    return <Text>{props.accessibilityLabel ?? 'icon'}</Text>;
  },
}));

// eslint-disable-next-line import/first
import { CoachCloudProviderPicker } from '@/components/settings/CoachCloudProviderPicker';
// eslint-disable-next-line import/first
import {
  resolveCloudProvider,
  setCloudProviderPreference,
} from '@/lib/services/coach-cloud-provider';

const mockResolveCloudProvider = resolveCloudProvider as jest.MockedFunction<typeof resolveCloudProvider>;
const mockSetCloudProviderPreference = setCloudProviderPreference as jest.MockedFunction<typeof setCloudProviderPreference>;

describe('CoachCloudProviderPicker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveCloudProvider.mockResolvedValue('openai');
    mockSetCloudProviderPreference.mockResolvedValue(undefined);
  });

  it('renders both provider options', async () => {
    const { findByTestId, getByText } = render(<CoachCloudProviderPicker />);

    await findByTestId('coach-cloud-provider-picker-option-openai');
    expect(getByText('OpenAI (default)')).toBeTruthy();
    expect(getByText('Google Gemma 3')).toBeTruthy();
  });

  it('loads the persisted preference and marks the selected option', async () => {
    mockResolveCloudProvider.mockResolvedValue('gemma');
    const { findByTestId } = render(<CoachCloudProviderPicker />);

    const gemmaOption = await findByTestId('coach-cloud-provider-picker-option-gemma');
    expect(gemmaOption.props.accessibilityState?.selected).toBe(true);

    const openaiOption = await findByTestId('coach-cloud-provider-picker-option-openai');
    expect(openaiOption.props.accessibilityState?.selected).toBe(false);
  });

  it('persists a newly selected provider', async () => {
    const { findByTestId } = render(<CoachCloudProviderPicker />);

    const gemmaOption = await findByTestId('coach-cloud-provider-picker-option-gemma');
    await act(async () => {
      fireEvent.press(gemmaOption);
    });

    await waitFor(() => {
      expect(mockSetCloudProviderPreference).toHaveBeenCalledWith('gemma');
    });
    expect(gemmaOption.props.accessibilityState?.selected).toBe(true);
  });

  it('invokes onChange with the newly selected provider', async () => {
    const onChange = jest.fn();
    const { findByTestId } = render(<CoachCloudProviderPicker onChange={onChange} />);

    const gemmaOption = await findByTestId('coach-cloud-provider-picker-option-gemma');
    await act(async () => {
      fireEvent.press(gemmaOption);
    });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('gemma'));
  });

  it('shows a disabled gemma option when availability is false', async () => {
    const { findByTestId, getByText } = render(
      <CoachCloudProviderPicker available={false} />,
    );

    const gemmaOption = await findByTestId('coach-cloud-provider-picker-option-gemma');
    expect(gemmaOption.props.accessibilityState?.disabled).toBe(true);
    expect(getByText(/Gemma unavailable/)).toBeTruthy();
  });

  it('does not persist when the disabled gemma option is pressed', async () => {
    const { findByTestId } = render(<CoachCloudProviderPicker available={false} />);
    const gemmaOption = await findByTestId('coach-cloud-provider-picker-option-gemma');

    await act(async () => {
      fireEvent.press(gemmaOption);
    });

    expect(mockSetCloudProviderPreference).not.toHaveBeenCalled();
  });

  it('does not persist or emit onChange when re-selecting the current provider', async () => {
    mockResolveCloudProvider.mockResolvedValue('openai');
    const onChange = jest.fn();
    const { findByTestId } = render(<CoachCloudProviderPicker onChange={onChange} />);

    const openaiOption = await findByTestId('coach-cloud-provider-picker-option-openai');
    await act(async () => {
      fireEvent.press(openaiOption);
    });

    expect(mockSetCloudProviderPreference).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('supports controlled mode via value prop without reading storage', async () => {
    const onChange = jest.fn();
    const { findByTestId } = render(
      <CoachCloudProviderPicker value="gemma" onChange={onChange} />,
    );

    const gemmaOption = await findByTestId('coach-cloud-provider-picker-option-gemma');
    expect(gemmaOption.props.accessibilityState?.selected).toBe(true);
    expect(mockResolveCloudProvider).not.toHaveBeenCalled();

    const openaiOption = await findByTestId('coach-cloud-provider-picker-option-openai');
    await act(async () => {
      fireEvent.press(openaiOption);
    });

    // controlled -> does not persist, parent handles state via onChange
    expect(mockSetCloudProviderPreference).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith('openai');
  });

  it('falls back to openai visually when the resolver throws', async () => {
    mockResolveCloudProvider.mockRejectedValue(new Error('boom'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { findByTestId } = render(<CoachCloudProviderPicker />);

    const openaiOption = await findByTestId('coach-cloud-provider-picker-option-openai');
    await waitFor(() =>
      expect(openaiOption.props.accessibilityState?.selected).toBe(true),
    );

    warnSpy.mockRestore();
  });
});
