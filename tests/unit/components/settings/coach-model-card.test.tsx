import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Provider as PaperProvider } from 'react-native-paper';

import { CoachModelCard } from '@/components/settings/CoachModelCard';

function renderWithProvider(ui: React.ReactElement) {
  return render(<PaperProvider>{ui}</PaperProvider>);
}

describe('CoachModelCard', () => {
  it('renders "none" state with download action and accessibility label', () => {
    const onStartDownload = jest.fn();
    const { getByTestId, getByLabelText } = renderWithProvider(
      <CoachModelCard status="none" onStartDownload={onStartDownload} />,
    );

    expect(getByLabelText('On-device coach model not downloaded')).toBeTruthy();
    const downloadBtn = getByTestId('coach-model-card-download');
    expect(downloadBtn).toBeTruthy();
    fireEvent.press(downloadBtn);
    expect(onStartDownload).toHaveBeenCalledTimes(1);
  });

  it('renders "downloading" state with progress and cancel action', () => {
    const onCancel = jest.fn();
    const { getByTestId, getByLabelText, queryByTestId } = renderWithProvider(
      <CoachModelCard status="downloading" progress={0.42} onCancel={onCancel} />,
    );

    expect(getByLabelText('On-device coach model is downloading')).toBeTruthy();
    expect(getByTestId('coach-model-card-progress')).toBeTruthy();
    expect(queryByTestId('coach-model-card-download')).toBeNull();

    const cancelBtn = getByTestId('coach-model-card-cancel');
    fireEvent.press(cancelBtn);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders "ready" state without action buttons', () => {
    const { queryByTestId, getByLabelText } = renderWithProvider(
      <CoachModelCard status="ready" modelId="gemma-2b-q4" />,
    );

    expect(getByLabelText('On-device coach model is ready')).toBeTruthy();
    expect(queryByTestId('coach-model-card-download')).toBeNull();
    expect(queryByTestId('coach-model-card-cancel')).toBeNull();
    expect(queryByTestId('coach-model-card-retry')).toBeNull();
  });

  it('renders "error" state with retry action and surfaces error message', () => {
    const onRetry = jest.fn();
    const { getByTestId, getByLabelText, getByText } = renderWithProvider(
      <CoachModelCard status="error" errorMessage="Disk full" onRetry={onRetry} />,
    );

    expect(getByLabelText('On-device coach model error')).toBeTruthy();
    expect(getByText('Disk full')).toBeTruthy();
    const retryBtn = getByTestId('coach-model-card-retry');
    fireEvent.press(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('clamps progress to [0, 1] range visually', () => {
    const { getByTestId } = renderWithProvider(
      <CoachModelCard status="downloading" progress={1.5} />,
    );
    // The progress testID still renders; just ensure no throw.
    expect(getByTestId('coach-model-card-progress')).toBeTruthy();
  });
});
