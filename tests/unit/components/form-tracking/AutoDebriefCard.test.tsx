/**
 * AutoDebriefCard — epoch guard around the awaitingResult grace window (A1).
 *
 * We primarily want to prove that a stale grace timeout from a previous
 * awaitingResult epoch cannot flip `inGrace` back to false on a newly
 * started grace window.
 */

import React from 'react';
import { act, render } from '@testing-library/react-native';

import AutoDebriefCard, {
  AUTO_DEBRIEF_EMPTY_GRACE_MS,
} from '@/components/form-tracking/AutoDebriefCard';

jest.useFakeTimers();

describe('AutoDebriefCard grace epoch', () => {
  afterEach(() => {
    jest.clearAllTimers();
  });

  it('shows the preparing copy while awaitingResult is true (grace)', () => {
    const { queryByTestId } = render(
      <AutoDebriefCard loading={false} error={null} data={null} awaitingResult />,
    );
    expect(queryByTestId('auto-debrief-preparing')).not.toBeNull();
    expect(queryByTestId('auto-debrief-empty')).toBeNull();
  });

  it('falls back to empty copy after the grace window elapses', () => {
    const { queryByTestId } = render(
      <AutoDebriefCard loading={false} error={null} data={null} awaitingResult />,
    );

    act(() => {
      jest.advanceTimersByTime(AUTO_DEBRIEF_EMPTY_GRACE_MS + 10);
    });

    expect(queryByTestId('auto-debrief-preparing')).toBeNull();
    expect(queryByTestId('auto-debrief-empty')).not.toBeNull();
  });

  it('a stale timeout from a previous grace epoch does not clear the new grace window', () => {
    const { rerender, queryByTestId } = render(
      <AutoDebriefCard loading={false} error={null} data={null} awaitingResult />,
    );

    // First epoch starts. Fast-forward just before it expires so the first
    // timeout would otherwise fire imminently.
    act(() => {
      jest.advanceTimersByTime(AUTO_DEBRIEF_EMPTY_GRACE_MS - 10);
    });

    // Flip awaitingResult false then true to start a new epoch.
    rerender(
      <AutoDebriefCard loading={false} error={null} data={null} awaitingResult={false} />,
    );
    rerender(
      <AutoDebriefCard loading={false} error={null} data={null} awaitingResult />,
    );

    // Advance just enough to fire the stale (first) epoch's timeout but not
    // the new epoch's timeout.
    act(() => {
      jest.advanceTimersByTime(20);
    });

    // We should still be in grace because the stale callback bailed when it
    // saw its epoch no longer matched graceEpochRef.current.
    expect(queryByTestId('auto-debrief-preparing')).not.toBeNull();
    expect(queryByTestId('auto-debrief-empty')).toBeNull();

    // Now run out the new grace window — should finally fall back to empty.
    act(() => {
      jest.advanceTimersByTime(AUTO_DEBRIEF_EMPTY_GRACE_MS + 10);
    });
    expect(queryByTestId('auto-debrief-preparing')).toBeNull();
    expect(queryByTestId('auto-debrief-empty')).not.toBeNull();
  });
});
