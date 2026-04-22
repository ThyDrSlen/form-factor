import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { Provider as PaperProvider } from 'react-native-paper';

import { CostDashboardCard, WEEKLY_TOKEN_BUDGET } from '@/components/settings/CostDashboardCard';
import type { WeeklyAggregate } from '@/lib/services/coach-cost-tracker';

function renderWithProvider(ui: React.ReactElement) {
  return render(<PaperProvider>{ui}</PaperProvider>);
}

function buildAggregate(overrides: Partial<WeeklyAggregate> = {}): WeeklyAggregate {
  return {
    rangeStart: '2026-04-14',
    rangeEnd: '2026-04-21',
    totalTokensIn: 0,
    totalTokensOut: 0,
    totalCalls: 0,
    cacheHitRate: 0,
    byProvider: {
      openai: { tokensIn: 0, tokensOut: 0, calls: 0 },
      gemma_cloud: { tokensIn: 0, tokensOut: 0, calls: 0 },
      gemma_ondevice: { tokensIn: 0, tokensOut: 0, calls: 0 },
      stub: { tokensIn: 0, tokensOut: 0, calls: 0 },
    },
    byTaskKind: {
      chat: { tokensIn: 0, tokensOut: 0, calls: 0 },
      debrief: { tokensIn: 0, tokensOut: 0, calls: 0 },
      drill_explainer: { tokensIn: 0, tokensOut: 0, calls: 0 },
      session_generator: { tokensIn: 0, tokensOut: 0, calls: 0 },
      progression_planner: { tokensIn: 0, tokensOut: 0, calls: 0 },
      other: { tokensIn: 0, tokensOut: 0, calls: 0 },
    },
    ...overrides,
  };
}

describe('CostDashboardCard', () => {
  it('shows a loading state while fetching', async () => {
    let resolveLoader: (agg: WeeklyAggregate) => void = () => {};
    const loader = () =>
      new Promise<WeeklyAggregate>((resolve) => {
        resolveLoader = resolve;
      });

    const { getByTestId } = renderWithProvider(
      <CostDashboardCard loadAggregate={loader} />,
    );
    expect(getByTestId('cost-dashboard-card-loading')).toBeTruthy();

    // Let the effect settle so the pending promise doesn't leak between tests.
    await act(async () => {
      resolveLoader(buildAggregate());
    });
  });

  it('renders total tokens + provider split when loaded', async () => {
    const aggregate = buildAggregate({
      totalTokensIn: 120_000,
      totalTokensOut: 80_000,
      totalCalls: 12,
      cacheHitRate: 0.25,
      byProvider: {
        openai: { tokensIn: 40_000, tokensOut: 20_000, calls: 4 },
        gemma_cloud: { tokensIn: 60_000, tokensOut: 40_000, calls: 6 },
        gemma_ondevice: { tokensIn: 20_000, tokensOut: 20_000, calls: 2 },
        stub: { tokensIn: 0, tokensOut: 0, calls: 0 },
      },
    });

    const { findByTestId, getByText, getByTestId } = renderWithProvider(
      <CostDashboardCard loadAggregate={() => Promise.resolve(aggregate)} />,
    );

    await findByTestId('cost-dashboard-card');

    // Total shows humanized token summary (in + out = 200K; budget = 1.0M).
    // The body text keeps the string intact under a stable testID.
    const totalText = getByTestId('cost-dashboard-card-total');
    expect(totalText.props.children).toBe('200K / 1.0M tokens');

    // Provider labels and humanized values.
    expect(getByText('OpenAI')).toBeTruthy();
    expect(getByText('Gemma cloud')).toBeTruthy();
    expect(getByText('Gemma on-device')).toBeTruthy();

    // 12 coach requests with cache hit rate 25% (under stable testID).
    const meta = getByTestId('cost-dashboard-card-meta');
    expect(meta.props.children).toBe('12 coach requests \u2022 cache hit rate 25%');
  });

  it('clamps progress to 100% when spend exceeds the budget', async () => {
    const aggregate = buildAggregate({
      totalTokensIn: WEEKLY_TOKEN_BUDGET,
      totalTokensOut: WEEKLY_TOKEN_BUDGET,
      totalCalls: 999,
    });
    const { findByText } = renderWithProvider(
      <CostDashboardCard loadAggregate={() => Promise.resolve(aggregate)} />,
    );

    await findByText('100% of weekly budget');
  });

  it('shows an error card when the loader rejects', async () => {
    const loader = () => Promise.reject(new Error('boom'));
    const { findByTestId } = renderWithProvider(
      <CostDashboardCard loadAggregate={loader} />,
    );
    await findByTestId('cost-dashboard-card-error');
  });

  it('handles an empty aggregate gracefully (0 calls, no cache hit line)', async () => {
    const { findByTestId, getByTestId } = renderWithProvider(
      <CostDashboardCard loadAggregate={() => Promise.resolve(buildAggregate())} />,
    );

    await findByTestId('cost-dashboard-card');
    const meta = getByTestId('cost-dashboard-card-meta');
    // When totalCalls is 0 we omit the "cache hit rate" suffix.
    expect(meta.props.children).toBe('0 coach requests');
  });

  it('respects a custom budget override', async () => {
    const aggregate = buildAggregate({
      totalTokensIn: 50,
      totalTokensOut: 50,
      totalCalls: 1,
    });
    const { findByText } = renderWithProvider(
      <CostDashboardCard
        loadAggregate={() => Promise.resolve(aggregate)}
        budget={200}
      />,
    );
    await findByText('50% of weekly budget');
  });

  it('survives an unexpected non-Error rejection', async () => {
    const loader = () => Promise.reject('legacy string rejection');
    const { findByTestId } = renderWithProvider(
      <CostDashboardCard loadAggregate={loader} />,
    );
    await waitFor(() => findByTestId('cost-dashboard-card-error'));
  });
});
