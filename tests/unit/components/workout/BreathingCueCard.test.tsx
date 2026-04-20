import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import BreathingCueCard from '@/components/workout/BreathingCueCard';
import { getBreathingPattern } from '@/lib/services/breathing-patterns';

jest.useFakeTimers();

describe('BreathingCueCard', () => {
  const box = getBreathingPattern('box');

  beforeEach(() => {
    jest.clearAllTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('renders the pattern name and description', () => {
    const { getByTestId, getByText } = render(<BreathingCueCard pattern={box} autoStart={false} />);
    expect(getByTestId('breathing-pattern-name').props.children).toBe('Box Breathing');
    expect(getByText(box.description)).toBeTruthy();
  });

  it('starts on the first phase with full seconds shown', () => {
    const { getByTestId } = render(<BreathingCueCard pattern={box} autoStart={false} />);
    const phaseText = getByTestId('breathing-phase');
    expect(phaseText).toBeTruthy();
    expect(getByTestId('breathing-seconds').props.children).toEqual([
      box.phases[0].seconds,
      's',
    ]);
  });

  it('shows the correct toggle label based on autoStart', () => {
    const stopped = render(<BreathingCueCard pattern={box} autoStart={false} />);
    expect(stopped.getByTestId('breathing-toggle').props.accessibilityLabel).toBe(
      'Start breathing guide',
    );
    const running = render(<BreathingCueCard pattern={box} autoStart={true} />);
    expect(running.getByTestId('breathing-toggle').props.accessibilityLabel).toBe(
      'Pause breathing guide',
    );
  });

  it('toggling pause/start flips accessibilityLabel', () => {
    const { getByTestId } = render(<BreathingCueCard pattern={box} autoStart={true} />);
    const toggle = getByTestId('breathing-toggle');
    expect(toggle.props.accessibilityLabel).toBe('Pause breathing guide');
    fireEvent.press(toggle);
    expect(toggle.props.accessibilityLabel).toBe('Start breathing guide');
  });

  it('advances through phases when time elapses', () => {
    const onPhaseChange = jest.fn();
    render(
      <BreathingCueCard pattern={box} autoStart={true} onPhaseChange={onPhaseChange} />,
    );

    act(() => {
      jest.advanceTimersByTime(box.phases[0].seconds * 1000);
    });
    expect(onPhaseChange).toHaveBeenCalled();
    const firstTransition = onPhaseChange.mock.calls[0];
    expect(firstTransition[1]).toBe(1);
  });

  it('loops back to the first phase after cycling through all phases', () => {
    const onPhaseChange = jest.fn();
    render(
      <BreathingCueCard pattern={box} autoStart={true} onPhaseChange={onPhaseChange} />,
    );

    const total = box.phases.reduce((acc, p) => acc + p.seconds, 0);
    act(() => {
      jest.advanceTimersByTime(total * 1000);
    });
    const lastCall = onPhaseChange.mock.calls[onPhaseChange.mock.calls.length - 1];
    expect(lastCall[1]).toBe(0);
  });

  it('resets when the pattern changes', () => {
    const { rerender, getByTestId } = render(
      <BreathingCueCard pattern={box} autoStart={false} />,
    );
    const coherent = getBreathingPattern('coherent');
    rerender(<BreathingCueCard pattern={coherent} autoStart={false} />);
    expect(getByTestId('breathing-pattern-name').props.children).toBe('Coherent Breathing');
    expect(getByTestId('breathing-seconds').props.children).toEqual([
      coherent.phases[0].seconds,
      's',
    ]);
  });
});
