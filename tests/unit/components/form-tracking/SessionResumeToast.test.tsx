import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SessionResumeToast } from '@/components/form-tracking/SessionResumeToast';

describe('SessionResumeToast', () => {
  it('renders null when not visible', () => {
    const { queryByTestId } = render(
      <SessionResumeToast visible={false} onResume={jest.fn()} />,
    );
    expect(queryByTestId('session-resume-toast')).toBeNull();
  });

  it('renders generic title when exercise name is missing', () => {
    const { getByText } = render(
      <SessionResumeToast visible onResume={jest.fn()} />,
    );
    expect(getByText('Resume previous set?')).toBeTruthy();
  });

  it('renders exercise-specific title when provided', () => {
    const { getByText } = render(
      <SessionResumeToast visible lastExerciseName="Pull-Ups" onResume={jest.fn()} />,
    );
    expect(getByText('Resume Pull-Ups?')).toBeTruthy();
  });

  it('shows the background subtitle when reason is background', () => {
    const { getByText } = render(
      <SessionResumeToast visible reason="background" onResume={jest.fn()} />,
    );
    expect(getByText('Session paused while you were away.')).toBeTruthy();
  });

  it('invokes onResume when Resume is tapped', () => {
    const onResume = jest.fn();
    const { getByTestId } = render(
      <SessionResumeToast visible onResume={onResume} />,
    );
    fireEvent.press(getByTestId('session-resume-toast-resume'));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('invokes onDismiss when ✕ is tapped', () => {
    const onDismiss = jest.fn();
    const { getByTestId } = render(
      <SessionResumeToast visible onResume={jest.fn()} onDismiss={onDismiss} />,
    );
    fireEvent.press(getByTestId('session-resume-toast-dismiss'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('hides dismiss button when onDismiss is not provided', () => {
    const { queryByTestId } = render(
      <SessionResumeToast visible onResume={jest.fn()} />,
    );
    expect(queryByTestId('session-resume-toast-dismiss')).toBeNull();
  });
});
