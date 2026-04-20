import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('moti', () => {
  const { View } = jest.requireActual('react-native');
  return {
    MotiView: View,
    MotiText: View,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  };
});

// eslint-disable-next-line import/first
import PostSessionSummaryCard from '../../../../components/form-tracking/PostSessionSummaryCard';

const BASE_METRICS = [
  { label: 'DURATION', value: '45m' },
  { label: 'SETS', value: '12' },
  { label: 'REPS', value: '96' },
  { label: 'VOLUME', value: '14,250', hint: 'lb' },
];

describe('PostSessionSummaryCard', () => {
  it('renders the title, duration and every metric', () => {
    const { getAllByText, getByText } = render(
      <PostSessionSummaryCard
        averageFqi={78}
        title="Tuesday upper push"
        durationLabel="45m"
        metrics={BASE_METRICS}
      />,
    );
    expect(getByText('Tuesday upper push')).toBeTruthy();
    // Duration label ("45m") appears both in the subtitle and in the
    // DURATION metric cell — accept either.
    expect(getAllByText('45m').length).toBeGreaterThan(0);
    BASE_METRICS.forEach((m) => {
      expect(getByText(m.label)).toBeTruthy();
    });
  });

  it('hides the insight row when no insight is provided', () => {
    const { queryByTestId } = render(
      <PostSessionSummaryCard averageFqi={null} metrics={BASE_METRICS} />,
    );
    expect(queryByTestId('post-session-insight')).toBeNull();
  });

  it('renders the insight with a descriptive accessibilityLabel', () => {
    const { getByTestId } = render(
      <PostSessionSummaryCard
        averageFqi={61}
        metrics={BASE_METRICS}
        insight={{
          title: 'Range of motion',
          body: 'You cut 2 of 12 squats short — push through the bottom a little more.',
          kind: 'warning',
        }}
      />,
    );
    expect(getByTestId('post-session-insight').props.accessibilityLabel).toMatch(
      /Range of motion/,
    );
  });

  it('fires onAnalyze when the full-analysis link is pressed', () => {
    const onAnalyze = jest.fn();
    const { getByTestId } = render(
      <PostSessionSummaryCard
        averageFqi={72}
        metrics={BASE_METRICS}
        onAnalyze={onAnalyze}
      />,
    );
    fireEvent.press(getByTestId('post-session-analyze'));
    expect(onAnalyze).toHaveBeenCalledTimes(1);
  });

  it('omits the analyze button when no handler is provided', () => {
    const { queryByTestId } = render(
      <PostSessionSummaryCard averageFqi={null} metrics={BASE_METRICS} />,
    );
    expect(queryByTestId('post-session-analyze')).toBeNull();
  });

  it('mentions the averageFqi in the card accessibilityLabel', () => {
    const { getByTestId } = render(
      <PostSessionSummaryCard averageFqi={84.4} metrics={BASE_METRICS} />,
    );
    expect(getByTestId('post-session-summary-card').props.accessibilityLabel).toMatch(
      /84/,
    );
  });
});
