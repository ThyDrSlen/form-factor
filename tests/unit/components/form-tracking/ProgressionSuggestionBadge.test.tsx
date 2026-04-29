/**
 * Tests for ProgressionSuggestionBadge.
 *
 * Covers render conditions for each rationale, the tap-affordance when
 * `onPress` is wired, and accessibility surface (role + label + testID).
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import ProgressionSuggestionBadge from '@/components/form-tracking/ProgressionSuggestionBadge';
import type { Suggestion } from '@/lib/services/progression-suggester';

function suggestion(overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    nextWeight: 185,
    rationale: 'increment',
    reason: '+5 lb — last set FQI 92',
    ...overrides,
  };
}

describe('ProgressionSuggestionBadge', () => {
  it('returns null when suggestion is null (renders nothing)', () => {
    const { toJSON } = render(<ProgressionSuggestionBadge suggestion={null} />);
    expect(toJSON()).toBeNull();
  });

  it('renders the increment rationale with the corresponding testID and reason text', () => {
    const { getByTestId, getByText } = render(
      <ProgressionSuggestionBadge suggestion={suggestion({ rationale: 'increment' })} />,
    );
    expect(getByTestId('progression-badge-increment')).toBeTruthy();
    expect(getByText(/\+5 lb/)).toBeTruthy();
  });

  it('renders the maintain rationale with its dedicated testID', () => {
    const { getByTestId } = render(
      <ProgressionSuggestionBadge
        suggestion={suggestion({ rationale: 'maintain', reason: 'Same weight — last FQI 82' })}
      />,
    );
    expect(getByTestId('progression-badge-maintain')).toBeTruthy();
  });

  it('renders the deload rationale with its dedicated testID', () => {
    const { getByTestId, getByText } = render(
      <ProgressionSuggestionBadge
        suggestion={suggestion({ rationale: 'deload', reason: '-10% — last FQI 68' })}
      />,
    );
    expect(getByTestId('progression-badge-deload')).toBeTruthy();
    expect(getByText(/-10%/)).toBeTruthy();
  });

  it('exposes accessibilityRole=text and label=reason when onPress is not wired', () => {
    const { getByTestId } = render(
      <ProgressionSuggestionBadge suggestion={suggestion()} />,
    );
    const badge = getByTestId('progression-badge-increment');
    expect(badge.props.accessibilityRole).toBe('text');
    expect(badge.props.accessibilityLabel).toBe('+5 lb — last set FQI 92');
  });

  it('switches accessibilityRole to button and forwards the hint when onPress is provided', () => {
    const { getByTestId } = render(
      <ProgressionSuggestionBadge
        suggestion={suggestion()}
        onPress={() => undefined}
        accessibilityHint="Applies the suggested load to your next set"
      />,
    );
    const badge = getByTestId('progression-badge-increment');
    expect(badge.props.accessibilityRole).toBe('button');
    expect(badge.props.accessibilityHint).toBe('Applies the suggested load to your next set');
  });

  it('invokes onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <ProgressionSuggestionBadge suggestion={suggestion()} onPress={onPress} />,
    );
    fireEvent.press(getByTestId('progression-badge-increment'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
