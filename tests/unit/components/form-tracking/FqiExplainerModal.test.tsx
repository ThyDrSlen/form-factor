import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args) }),
}));

// eslint-disable-next-line import/first
import { FqiExplainerModal } from '@/components/form-tracking/FqiExplainerModal';
// eslint-disable-next-line import/first
import { FormQualityBadge } from '@/components/form-tracking/FormQualityBadge';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('FqiExplainerModal', () => {
  it('renders legend rows for all four tiers', () => {
    const { getByTestId } = render(
      <FqiExplainerModal visible onDismiss={jest.fn()} />,
    );
    expect(getByTestId('fqi-explainer-modal-legend-excellent')).toBeTruthy();
    expect(getByTestId('fqi-explainer-modal-legend-good')).toBeTruthy();
    expect(getByTestId('fqi-explainer-modal-legend-needs-work')).toBeTruthy();
    expect(getByTestId('fqi-explainer-modal-legend-refocus-on-basics')).toBeTruthy();
  });

  it('renders the drills CTA only when exerciseId is provided', () => {
    const { queryByTestId, rerender } = render(
      <FqiExplainerModal visible onDismiss={jest.fn()} />,
    );
    expect(queryByTestId('fqi-explainer-modal-see-drills')).toBeNull();

    rerender(
      <FqiExplainerModal visible onDismiss={jest.fn()} exerciseId="pullup" />,
    );
    expect(queryByTestId('fqi-explainer-modal-see-drills')).toBeTruthy();
  });

  it('routes to form-quality-recovery with exerciseId on drills tap', () => {
    const onDismiss = jest.fn();
    const { getByTestId } = render(
      <FqiExplainerModal visible onDismiss={onDismiss} exerciseId="pullup" />,
    );
    fireEvent.press(getByTestId('fqi-explainer-modal-see-drills'));
    expect(mockPush).toHaveBeenCalledWith(
      '/(modals)/form-quality-recovery?exerciseId=pullup',
    );
    // It also dismisses itself so the stack doesn't end up with two modals.
    expect(onDismiss).toHaveBeenCalled();
  });

  it('calls onDismiss when the close and dismiss buttons are pressed', () => {
    const onDismiss = jest.fn();
    const { getByTestId } = render(
      <FqiExplainerModal visible onDismiss={onDismiss} />,
    );
    fireEvent.press(getByTestId('fqi-explainer-modal-close'));
    fireEvent.press(getByTestId('fqi-explainer-modal-dismiss'));
    fireEvent.press(getByTestId('fqi-explainer-modal-backdrop'));
    expect(onDismiss).toHaveBeenCalledTimes(3);
  });

  it('includes three improvement tips', () => {
    const { getByTestId } = render(
      <FqiExplainerModal visible onDismiss={jest.fn()} />,
    );
    const tips = getByTestId('fqi-explainer-modal-tips');
    // children[] length should be 3 (one Text per tip row)
    // In RN Testing Library, children are the composite tree's direct descendants.
    expect(Array.isArray(tips.children) ? tips.children.length : 0).toBe(3);
  });
});

describe('FormQualityBadge — tappable mode', () => {
  it('renders as a button and fires onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <FormQualityBadge score={82} onPress={onPress} />,
    );
    const badge = getByTestId('form-quality-badge');
    expect(badge.props.accessibilityRole).toBe('button');
    expect(badge.props.accessibilityHint).toBe(
      'Tap to learn what this score means',
    );
    expect(getByTestId('form-quality-badge-info-icon')).toBeTruthy();
    fireEvent.press(badge);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not render the info icon when onPress is omitted', () => {
    const { queryByTestId } = render(<FormQualityBadge score={82} />);
    expect(queryByTestId('form-quality-badge-info-icon')).toBeNull();
  });
});
