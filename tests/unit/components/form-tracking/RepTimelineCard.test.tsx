import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import RepTimelineCard from '@/components/form-tracking/RepTimelineCard';
import {
  buildRepQualityTimeline,
} from '@/lib/services/rep-quality-timeline';
import type { RepQualityEntry } from '@/lib/services/rep-quality-log';

function mkEntry(partial: Partial<RepQualityEntry> = {}): RepQualityEntry {
  return {
    sessionId: 's1',
    repIndex: partial.repIndex ?? 1,
    exercise: 'squat',
    ts: partial.ts ?? `2026-04-17T09:00:0${partial.repIndex ?? 1}.000Z`,
    fqi: 80,
    faults: [],
    ...partial,
  };
}

describe('RepTimelineCard', () => {
  it('renders the default title and empty state when the timeline has no reps', () => {
    const timeline = buildRepQualityTimeline([]);
    const { getByText } = render(<RepTimelineCard timeline={timeline} />);
    expect(getByText('Rep timeline')).toBeTruthy();
    expect(getByText('No reps recorded yet.')).toBeTruthy();
  });

  it('renders a custom title when provided', () => {
    const timeline = buildRepQualityTimeline([]);
    const { getByText } = render(<RepTimelineCard timeline={timeline} title="Today's session" />);
    expect(getByText("Today's session")).toBeTruthy();
  });

  it('renders a rep-count subtitle with avg FQI when reps are present', () => {
    const timeline = buildRepQualityTimeline([
      mkEntry({ repIndex: 1, fqi: 80 }),
      mkEntry({ repIndex: 2, fqi: 90 }),
    ]);
    const { getByText } = render(<RepTimelineCard timeline={timeline} />);
    expect(getByText(/2 reps/)).toBeTruthy();
    expect(getByText(/avg FQI 85/)).toBeTruthy();
  });

  it('renders one rep segment per rep and a fault hint when faults are present', () => {
    const timeline = buildRepQualityTimeline([
      mkEntry({ repIndex: 1, fqi: 50, faults: ['forward_knee'] }),
    ]);
    const { getAllByText, getByText } = render(<RepTimelineCard timeline={timeline} />);
    // Rep segment
    expect(getByText(/Rep 1 · FQI 50/)).toBeTruthy();
    // Fault segment plus fault hint
    expect(getAllByText(/forward_knee/).length).toBeGreaterThan(0);
  });

  it('surfaces a tracking-lost segment with an explanatory hint', () => {
    const timeline = buildRepQualityTimeline([mkEntry({ repIndex: 1, occluded: true })]);
    const { getAllByText } = render(<RepTimelineCard timeline={timeline} />);
    expect(getAllByText(/tracking lost/).length).toBeGreaterThan(0);
  });

  it('fires onSelectSegment with the tapped segment', () => {
    const timeline = buildRepQualityTimeline([
      mkEntry({ repIndex: 1, fqi: 80 }),
      mkEntry({ repIndex: 2, fqi: 90, faults: ['shallow'] }),
    ]);
    const onSelect = jest.fn();
    const { getAllByRole } = render(
      <RepTimelineCard timeline={timeline} onSelectSegment={onSelect} />
    );
    const buttons = getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(3); // 2 reps + 1 fault
    fireEvent.press(buttons[0]);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].type).toBe('rep');
    expect(onSelect.mock.calls[0][0].repIndex).toBe(1);
  });

  it('renders non-interactive rows when onSelectSegment is omitted', () => {
    const timeline = buildRepQualityTimeline([mkEntry({ repIndex: 1 })]);
    const { queryAllByRole } = render(<RepTimelineCard timeline={timeline} />);
    expect(queryAllByRole('button')).toHaveLength(0);
  });
});
