/**
 * Integration test for contexts/WatchSessionBridgeContext.tsx.
 *
 * Last-mile wiring test for #440. Proves the provider:
 *   1. Renders children pass-through.
 *   2. On mount, subscribes the bridge to session-runner's event registry.
 *   3. Forwards a routed event end-to-end: emitted event → sendMessage call
 *      with the session_event payload shape.
 *   4. Filters non-routed events so the watch channel stays quiet.
 *   5. On unmount, the bridge's teardown runs (unsubscribe invoked).
 *
 * Boundaries mocked: `sendMessage` from `@/lib/watch-connectivity` and
 * `subscribeToEvents` from `@/lib/stores/session-runner`. The
 * WatchSessionBridgeProvider + initWatchSessionBridge wiring under test is
 * real — this test exists specifically to prove the provider binds them
 * together and cleans up on unmount.
 */

const mockSendMessage = jest.fn();
const mockSubscribeToEvents = jest.fn();
const mockUnsubscribe = jest.fn();

jest.mock('@/lib/watch-connectivity', () => ({
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
}));

jest.mock('@/lib/logger', () => ({
  warnWithTs: jest.fn(),
  logWithTs: jest.fn(),
  errorWithTs: jest.fn(),
}));

jest.mock('@/lib/stores/session-runner', () => ({
  subscribeToEvents: (...args: unknown[]) => mockSubscribeToEvents(...args),
}));

import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import type { WorkoutSessionEvent } from '@/lib/types/workout-session';
import { WatchSessionBridgeProvider } from '@/contexts/WatchSessionBridgeContext';

type Listener = (event: WorkoutSessionEvent) => void;

function buildEvent(overrides: Partial<WorkoutSessionEvent> = {}): WorkoutSessionEvent {
  return {
    id: 'evt-int-1',
    session_id: 'sess-int-1',
    created_at: new Date('2026-04-20T12:00:00.000Z').toISOString(),
    type: 'set_completed',
    session_exercise_id: 'sex-int-1',
    session_set_id: 'set-int-1',
    payload: { actual_reps: 5 },
    ...overrides,
  };
}

describe('WatchSessionBridgeProvider (integration)', () => {
  let capturedListener: Listener | null;

  beforeEach(() => {
    jest.clearAllMocks();
    capturedListener = null;
    mockSubscribeToEvents.mockImplementation((listener: Listener) => {
      capturedListener = listener;
      return mockUnsubscribe;
    });
  });

  it('renders children untouched', () => {
    const { queryByText } = render(
      <WatchSessionBridgeProvider>
        <Text>child-content</Text>
      </WatchSessionBridgeProvider>,
    );
    expect(queryByText('child-content')).not.toBeNull();
  });

  it('subscribes to session-runner exactly once on mount', () => {
    render(
      <WatchSessionBridgeProvider>
        <Text>x</Text>
      </WatchSessionBridgeProvider>,
    );
    expect(mockSubscribeToEvents).toHaveBeenCalledTimes(1);
    expect(typeof mockSubscribeToEvents.mock.calls[0][0]).toBe('function');
  });

  it('forwards a routed session event end-to-end through the mounted bridge', () => {
    render(
      <WatchSessionBridgeProvider>
        <Text>x</Text>
      </WatchSessionBridgeProvider>,
    );

    expect(capturedListener).not.toBeNull();
    capturedListener!(buildEvent({ type: 'set_completed' }));

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const [msg] = mockSendMessage.mock.calls[0];
    expect(msg).toMatchObject({
      v: 1,
      type: 'session_event',
      event: 'set_completed',
      sessionId: 'sess-int-1',
      sessionSetId: 'set-int-1',
      sessionExerciseId: 'sex-int-1',
    });
  });

  it('filters non-routed events so the watch channel stays quiet', () => {
    render(
      <WatchSessionBridgeProvider>
        <Text>x</Text>
      </WatchSessionBridgeProvider>,
    );

    capturedListener!(buildEvent({ type: 'set_started' }));
    capturedListener!(buildEvent({ type: 'session_started', session_set_id: null }));

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('tears down the bridge subscription on unmount', () => {
    const { unmount } = render(
      <WatchSessionBridgeProvider>
        <Text>x</Text>
      </WatchSessionBridgeProvider>,
    );

    expect(mockUnsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });
});
