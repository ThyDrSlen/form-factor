/**
 * AutoDebriefCard — accessibility + state-matrix coverage.
 *
 * A broader render-matrix test lives at
 * `tests/unit/components/AutoDebriefCard.test.tsx`. THIS file is a focused
 * accessibility regression suite that asserts the a11y contract on the
 * form-tracking card path specifically (roles, labels, liveness). Keep both
 * files — they guard different concerns.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import AutoDebriefCard from '@/components/form-tracking/AutoDebriefCard';
import type { AutoDebriefResult } from '@/lib/services/coach-auto-debrief';

function result(overrides: Partial<AutoDebriefResult> = {}): AutoDebriefResult {
  return {
    sessionId: 'sess-a11y',
    provider: 'gemma',
    brief: 'Solid session. Focus on keeping your chest up next time.',
    generatedAt: '2026-04-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('AutoDebriefCard (a11y contract)', () => {
  it('loading state is an alert region with a descriptive label for screen readers', () => {
    const { getByTestId } = render(
      <AutoDebriefCard loading={true} error={null} data={null} />,
    );
    const node = getByTestId('auto-debrief-loading');
    expect(node.props.accessibilityRole).toBe('alert');
    expect(node.props.accessibilityLabel).toMatch(/preparing/i);
  });

  it('error state is an alert region with the failure reason embedded in the label', () => {
    const { getByTestId } = render(
      <AutoDebriefCard loading={false} error="network offline" data={null} />,
    );
    const node = getByTestId('auto-debrief-error');
    expect(node.props.accessibilityRole).toBe('alert');
    expect(node.props.accessibilityLabel).toMatch(/network offline/);
  });

  it('retry CTA has button role, an explicit accessibilityLabel, and fires onRetry', () => {
    const onRetry = jest.fn();
    const { getByTestId } = render(
      <AutoDebriefCard
        loading={false}
        error="offline"
        data={null}
        onRetry={onRetry}
      />,
    );
    const cta = getByTestId('auto-debrief-retry');
    expect(cta.props.accessibilityRole).toBe('button');
    expect(cta.props.accessibilityLabel).toMatch(/retry/i);
    fireEvent.press(cta);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('preparing (grace) state is an alert region with its own label', () => {
    const { getByTestId } = render(
      <AutoDebriefCard loading={false} error={null} data={null} awaitingResult />,
    );
    const node = getByTestId('auto-debrief-preparing');
    expect(node.props.accessibilityRole).toBe('alert');
    expect(node.props.accessibilityLabel).toMatch(/preparing/i);
  });

  it('data state exposes role=summary and a provider-aware label', () => {
    const { getByTestId } = render(
      <AutoDebriefCard
        loading={false}
        error={null}
        data={result({ provider: 'gemma' })}
      />,
    );
    const node = getByTestId('auto-debrief-result');
    expect(node.props.accessibilityRole).toBe('summary');
    expect(node.props.accessibilityLabel).toMatch(/gemma/i);
  });

  it('provider badge renders both Gemma and OpenAI labels correctly', () => {
    const { getByText, rerender } = render(
      <AutoDebriefCard
        loading={false}
        error={null}
        data={result({ provider: 'openai' })}
      />,
    );
    expect(getByText('OpenAI')).toBeTruthy();
    rerender(
      <AutoDebriefCard
        loading={false}
        error={null}
        data={result({ provider: 'gemma' })}
      />,
    );
    expect(getByText('Gemma')).toBeTruthy();
  });
});
