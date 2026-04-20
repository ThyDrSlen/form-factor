import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { PreSetPreviewCard } from '@/components/form-tracking/PreSetPreviewCard';
import type { PreSetPreviewResult } from '@/lib/services/pre-set-preview';

const goodVerdict: PreSetPreviewResult = {
  verdict: '✓ Good, ready to pull.',
  isFormGood: true,
  provider: 'gemma',
};

const warnVerdict: PreSetPreviewResult = {
  verdict: '⚠ Elbows should be straighter',
  isFormGood: false,
  provider: 'openai',
};

describe('PreSetPreviewCard', () => {
  const baseProps = {
    visible: true,
    isChecking: false,
    verdict: null as PreSetPreviewResult | null,
    error: null as Error | null,
    exerciseName: 'deadlift',
    onDismiss: jest.fn(),
  };

  beforeEach(() => {
    baseProps.onDismiss = jest.fn();
  });

  it('renders idle / nothing beyond header when no state is supplied', () => {
    const { queryByTestId, getByText } = render(<PreSetPreviewCard {...baseProps} />);
    expect(getByText('Stance check')).toBeTruthy();
    expect(getByText('deadlift')).toBeTruthy();
    expect(queryByTestId('pre-set-preview-loading')).toBeNull();
    expect(queryByTestId('pre-set-preview-verdict')).toBeNull();
    expect(queryByTestId('pre-set-preview-error')).toBeNull();
  });

  it('renders the checking state', () => {
    const { getByTestId, queryByTestId, getByText } = render(
      <PreSetPreviewCard {...baseProps} isChecking />
    );
    expect(getByTestId('pre-set-preview-loading')).toBeTruthy();
    expect(getByText('Checking your stance…')).toBeTruthy();
    expect(queryByTestId('pre-set-preview-verdict')).toBeNull();
    expect(queryByTestId('pre-set-preview-error')).toBeNull();
  });

  it('renders the good verdict + Start Set button when onStartSet is supplied', () => {
    const onStartSet = jest.fn();
    const { getByTestId, getByText } = render(
      <PreSetPreviewCard
        {...baseProps}
        verdict={goodVerdict}
        onStartSet={onStartSet}
      />
    );
    expect(getByTestId('pre-set-preview-verdict')).toBeTruthy();
    expect(getByText('✓ Good, ready to pull.')).toBeTruthy();
    expect(getByText('via Gemma (on-device)')).toBeTruthy();
    const startBtn = getByTestId('pre-set-preview-start-set');
    fireEvent.press(startBtn);
    expect(onStartSet).toHaveBeenCalledTimes(1);
  });

  it('renders the warning verdict and omits Start Set', () => {
    const onStartSet = jest.fn();
    const { getByText, queryByTestId } = render(
      <PreSetPreviewCard
        {...baseProps}
        verdict={warnVerdict}
        onStartSet={onStartSet}
      />
    );
    expect(getByText('⚠ Elbows should be straighter')).toBeTruthy();
    expect(queryByTestId('pre-set-preview-start-set')).toBeNull();
    expect(onStartSet).not.toHaveBeenCalled();
    expect(getByText('via OpenAI')).toBeTruthy();
  });

  it('renders the error state and fires onRetry when Retry is pressed', () => {
    const onRetry = jest.fn();
    const { getByTestId, getByText } = render(
      <PreSetPreviewCard
        {...baseProps}
        error={new Error('coach offline')}
        onRetry={onRetry}
      />
    );
    expect(getByTestId('pre-set-preview-error')).toBeTruthy();
    expect(getByText('Could not check stance: coach offline')).toBeTruthy();
    fireEvent.press(getByTestId('pre-set-preview-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('always surfaces the Dismiss button and wires it to onDismiss', () => {
    const { getByTestId } = render(<PreSetPreviewCard {...baseProps} />);
    fireEvent.press(getByTestId('pre-set-preview-dismiss'));
    expect(baseProps.onDismiss).toHaveBeenCalledTimes(1);
  });
});
