/**
 * Tests for AutoDebriefCard.
 *
 * Covers the four render states (loading / error / empty / data),
 * provider label mapping, and that onRetry fires when the error CTA is
 * tapped.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import AutoDebriefCard from '@/components/form-tracking/AutoDebriefCard';
import type { AutoDebriefResult } from '@/lib/services/coach-auto-debrief';

function result(overrides: Partial<AutoDebriefResult> = {}): AutoDebriefResult {
  return {
    sessionId: 'sess-1',
    provider: 'openai',
    brief: 'Great session. Focus on depth next time.\nNext session: 3x5 at RPE 7.',
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('AutoDebriefCard', () => {
  it('renders the loading state with a skeleton when loading=true', () => {
    const { getByTestId, getByLabelText } = render(
      <AutoDebriefCard loading={true} error={null} data={null} />,
    );
    expect(getByTestId('auto-debrief-loading')).toBeTruthy();
    expect(getByLabelText('Coach is preparing your session debrief')).toBeTruthy();
  });

  it('renders the error state with a Try again CTA when error is set', () => {
    const onRetry = jest.fn();
    const { getByTestId, getByText } = render(
      <AutoDebriefCard
        loading={false}
        error="coach offline"
        data={null}
        onRetry={onRetry}
      />,
    );
    expect(getByTestId('auto-debrief-error')).toBeTruthy();
    expect(getByText(/coach offline/i)).toBeTruthy();

    fireEvent.press(getByTestId('auto-debrief-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('omits the retry CTA when onRetry is not provided', () => {
    const { queryByTestId } = render(
      <AutoDebriefCard loading={false} error="boom" data={null} />,
    );
    expect(queryByTestId('auto-debrief-retry')).toBeNull();
  });

  it('renders the empty state when there is no data and no error', () => {
    const { getByTestId, getByText } = render(
      <AutoDebriefCard loading={false} error={null} data={null} />,
    );
    expect(getByTestId('auto-debrief-empty')).toBeTruthy();
    expect(getByText(/No debrief yet/i)).toBeTruthy();
  });

  it('renders the awaiting-grace copy when awaitingResult=true and no data', () => {
    const { getByTestId, getByText, queryByTestId } = render(
      <AutoDebriefCard loading={false} error={null} data={null} awaitingResult />,
    );
    expect(getByTestId('auto-debrief-preparing')).toBeTruthy();
    expect(getByText(/Coach is preparing your feedback/i)).toBeTruthy();
    // The cold "no debrief yet" placeholder must NOT be rendered simultaneously.
    expect(queryByTestId('auto-debrief-empty')).toBeNull();
  });

  it('renders the shaped brief and the OpenAI provider badge by default', () => {
    const { getByTestId, getByText } = render(
      <AutoDebriefCard loading={false} error={null} data={result()} />,
    );
    expect(getByTestId('auto-debrief-result')).toBeTruthy();
    expect(getByText(/Focus on depth next time/)).toBeTruthy();
    expect(getByText('OpenAI')).toBeTruthy();
  });

  it('renders the Gemma badge when provider=gemma', () => {
    const { getByText } = render(
      <AutoDebriefCard
        loading={false}
        error={null}
        data={result({ provider: 'gemma', brief: 'Solid block.' })}
      />,
    );
    expect(getByText('Gemma')).toBeTruthy();
  });

  it('loading state wins over error and data', () => {
    const { getByTestId, queryByTestId } = render(
      <AutoDebriefCard loading={true} error="ignored" data={result()} />,
    );
    expect(getByTestId('auto-debrief-loading')).toBeTruthy();
    expect(queryByTestId('auto-debrief-error')).toBeNull();
    expect(queryByTestId('auto-debrief-result')).toBeNull();
  });

  it('error state wins over data when loading=false', () => {
    const { getByTestId, queryByTestId } = render(
      <AutoDebriefCard loading={false} error="no net" data={result()} />,
    );
    expect(getByTestId('auto-debrief-error')).toBeTruthy();
    expect(queryByTestId('auto-debrief-result')).toBeNull();
  });

  it('honours a custom testIDPrefix for sub-element targeting', () => {
    const { getByTestId } = render(
      <AutoDebriefCard
        loading={false}
        error={null}
        data={result()}
        testIDPrefix="debrief-card"
      />,
    );
    expect(getByTestId('debrief-card-result')).toBeTruthy();
    expect(getByTestId('debrief-card-brief')).toBeTruthy();
    expect(getByTestId('debrief-card-provider')).toBeTruthy();
  });
});
