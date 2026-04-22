import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Card, ProgressBar, Text } from 'react-native-paper';

import {
  getWeeklyAggregate,
  type WeeklyAggregate,
} from '@/lib/services/coach-cost-tracker';

/**
 * Soft weekly budget used to render the progress bar. Not a hard cap — the
 * dispatcher enforces real quota separately. We ship a conservative default
 * so users get a visible "progress to budget" signal before hitting 429.
 */
export const WEEKLY_TOKEN_BUDGET = 1_000_000;

export interface CostDashboardCardProps {
  /** Override the aggregate loader for tests. */
  loadAggregate?: () => Promise<WeeklyAggregate>;
  /** Override the weekly budget (tests). Defaults to WEEKLY_TOKEN_BUDGET. */
  budget?: number;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; aggregate: WeeklyAggregate }
  | { kind: 'error'; message: string };

function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  }
  return `${n}`;
}

/**
 * Weekly coach token-spend read-out. Pure consumer of
 * `lib/services/coach-cost-tracker`; it does not mutate any shared state.
 *
 * Shows:
 *   - total tokens used in the last 7 days (in + out)
 *   - provider split (OpenAI vs Gemma cloud vs Gemma on-device)
 *   - progress bar toward a soft weekly budget
 */
export function CostDashboardCard(props: CostDashboardCardProps) {
  const { loadAggregate, budget = WEEKLY_TOKEN_BUDGET } = props;
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let alive = true;
    const loader = loadAggregate ?? getWeeklyAggregate;
    loader()
      .then((aggregate) => {
        if (!alive) return;
        setState({ kind: 'ready', aggregate });
      })
      .catch((error: unknown) => {
        if (!alive) return;
        const message =
          error instanceof Error ? error.message : 'Unable to load coach usage.';
        setState({ kind: 'error', message });
      });
    return () => {
      alive = false;
    };
  }, [loadAggregate]);

  if (state.kind === 'loading') {
    return (
      <Card mode="outlined" style={styles.card} testID="cost-dashboard-card-loading">
        <Card.Title
          title="Weekly coach usage"
          subtitle="Loading…"
        />
      </Card>
    );
  }

  if (state.kind === 'error') {
    return (
      <Card mode="outlined" style={styles.card} testID="cost-dashboard-card-error">
        <Card.Title
          title="Weekly coach usage"
          subtitle={state.message}
          subtitleNumberOfLines={2}
        />
      </Card>
    );
  }

  const { aggregate } = state;
  const totalTokens = aggregate.totalTokensIn + aggregate.totalTokensOut;
  const openaiTokens =
    aggregate.byProvider.openai.tokensIn + aggregate.byProvider.openai.tokensOut;
  const gemmaCloudTokens =
    aggregate.byProvider.gemma_cloud.tokensIn + aggregate.byProvider.gemma_cloud.tokensOut;
  const gemmaOnDeviceTokens =
    aggregate.byProvider.gemma_ondevice.tokensIn +
    aggregate.byProvider.gemma_ondevice.tokensOut;
  const budgetSafe = budget > 0 ? budget : WEEKLY_TOKEN_BUDGET;
  const progress = Math.max(0, Math.min(1, totalTokens / budgetSafe));

  const totalSummary = `${formatTokens(totalTokens)} / ${formatTokens(budgetSafe)} tokens`;

  return (
    <Card
      mode="outlined"
      style={styles.card}
      accessible
      accessibilityLabel="Weekly coach token usage"
      testID="cost-dashboard-card"
    >
      <Card.Title
        title="Weekly coach usage"
        subtitle={totalSummary}
        subtitleNumberOfLines={1}
      />
      <View style={styles.body}>
        <Text
          variant="labelSmall"
          style={styles.totalSummary}
          testID="cost-dashboard-card-total"
        >
          {totalSummary}
        </Text>
        <View style={styles.progressWrap} testID="cost-dashboard-card-progress">
          <ProgressBar progress={progress} />
          <Text variant="labelSmall" style={styles.progressLabel}>
            {Math.round(progress * 100)}% of weekly budget
          </Text>
        </View>
        <View style={styles.splitRow} testID="cost-dashboard-card-split">
          <SplitEntry label="OpenAI" tokens={openaiTokens} />
          <SplitEntry label="Gemma cloud" tokens={gemmaCloudTokens} />
          <SplitEntry label="Gemma on-device" tokens={gemmaOnDeviceTokens} />
        </View>
        <Text
          variant="labelSmall"
          style={styles.meta}
          testID="cost-dashboard-card-meta"
        >
          {`${aggregate.totalCalls} coach request${aggregate.totalCalls === 1 ? '' : 's'}${
            aggregate.totalCalls > 0
              ? ` \u2022 cache hit rate ${Math.round(aggregate.cacheHitRate * 100)}%`
              : ''
          }`}
        </Text>
      </View>
    </Card>
  );
}

function SplitEntry({ label, tokens }: { label: string; tokens: number }) {
  return (
    <View style={styles.splitEntry}>
      <Text variant="labelSmall" style={styles.splitLabel}>
        {label}
      </Text>
      <Text variant="bodyMedium" style={styles.splitValue}>
        {formatTokens(tokens)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginVertical: 8,
  },
  body: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
  },
  totalSummary: {
    opacity: 0.7,
  },
  progressWrap: {
    gap: 4,
  },
  progressLabel: {
    alignSelf: 'flex-end',
    opacity: 0.7,
  },
  splitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  splitEntry: {
    flex: 1,
  },
  splitLabel: {
    opacity: 0.6,
  },
  splitValue: {
    fontWeight: '600',
  },
  meta: {
    opacity: 0.6,
  },
});
