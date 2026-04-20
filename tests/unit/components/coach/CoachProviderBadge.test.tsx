import { render } from '@testing-library/react-native';
import React from 'react';

import { CoachProviderBadge } from '@/components/coach/CoachProviderBadge';
import type { CoachProvider } from '@/lib/services/coach-provider-types';

describe('CoachProviderBadge', () => {
  it.each<[CoachProvider, string, RegExp]>([
    ['openai', 'GPT', /gpt/i],
    ['gemma-cloud', 'Gemma', /gemma by google/i],
    ['gemma-on-device', 'Gemma • on device', /gemma running on this device/i],
    ['local-fallback', 'Local fallback', /local fallback/i],
    ['cached', 'From cache', /cached/i],
  ])('renders label + a11y for provider=%s', (provider, label, a11yPattern) => {
    const { getByText, getByTestId } = render(<CoachProviderBadge provider={provider} />);

    expect(getByText(label)).toBeTruthy();
    const badge = getByTestId(`coach-provider-badge-${provider}`);
    expect(badge.props.accessibilityLabel).toMatch(a11yPattern);
  });

  it('honours an explicit testID prop', () => {
    const { getByTestId } = render(
      <CoachProviderBadge provider="openai" testID="custom-badge" />
    );
    expect(getByTestId('custom-badge')).toBeTruthy();
  });

  it('uses the Gemma accent color on gemma-cloud badges', () => {
    const { getByText } = render(<CoachProviderBadge provider="gemma-cloud" />);
    const label = getByText('Gemma');
    const flat = Array.isArray(label.props.style)
      ? Object.assign({}, ...label.props.style)
      : label.props.style;
    expect(flat.color).toBe('#4285F4');
  });

  it('falls back to a neutral pill when provider is unexpected', () => {
    // Cast-through an invalid value to exercise the switch default branch.
    const { getByText } = render(
      <CoachProviderBadge provider={'surprise' as CoachProvider} />
    );
    expect(getByText('Coach')).toBeTruthy();
  });
});
