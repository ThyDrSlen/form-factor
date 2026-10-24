import { buildWatchTrackingPayload } from '@/lib/watch-connectivity/tracking-payload';
import { planWatchTrackingPublication, type WatchTrackingPublicationState } from '@/lib/watch-connectivity/tracking-publication';

const initial = (): WatchTrackingPublicationState => ({ lastSubmission: null, timestamp: 0 });
const snapshot = (now: number, isTracking: boolean, reps = 2) => buildWatchTrackingPayload({
  now, isTracking, reps, mode: 'pullup', phase: isTracking ? 'ascending' : 'rest',
  primaryCue: null, metrics: { elbow: 90 },
});

describe('pure Watch tracking publication decision', () => {
  it('resumes changed metrics after clock rollback without losing wire ordering or the normal throttle', () => {
    const first = planWatchTrackingPublication(initial(), snapshot(10000, true, 2));
    const rolledBack = planWatchTrackingPublication(first.state, snapshot(1000, true, 3));
    expect(rolledBack.payload?.reps).toBe(3);
    expect(rolledBack.payload?.ts).toBe(first.state.timestamp + 1);
    expect(rolledBack.state.lastSubmission?.at).toBe(1000);

    const throttled = planWatchTrackingPublication(rolledBack.state, snapshot(1100, true, 4));
    expect(throttled.payload).toBeNull();
    expect(throttled.state).toBe(rolledBack.state);
    const next = planWatchTrackingPublication(throttled.state, snapshot(1250, true, 5));
    expect(next.payload?.reps).toBe(5);
    expect(next.payload?.ts).toBe(rolledBack.state.timestamp + 1);
  });

  it('flushes an exercise change immediately without carrying old throttled metrics into the new scan', () => {
    const first = planWatchTrackingPublication(initial(), snapshot(1000, true));
    const dropped = planWatchTrackingPublication(first.state, snapshot(1100, true, 99));
    const next = snapshot(1100, true, 0);
    next.tracking.mode = 'squat';
    const result = planWatchTrackingPublication(dropped.state, next);
    expect(result.payload?.tracking).toEqual(next.tracking);
    expect(result.payload?.ts).toBe(1100);
  });

  it('orders same-ms lifecycle transitions even after wall-clock rollback and local scope invalidation', () => {
    const first = planWatchTrackingPublication(initial(), snapshot(1000, true));
    const stop = planWatchTrackingPublication(first.state, snapshot(1000, false));
    const restart = planWatchTrackingPublication(stop.state, snapshot(900, true));
    const newScope = planWatchTrackingPublication({ ...restart.state, lastSubmission: null }, snapshot(900, true));
    expect([first, stop, restart, newScope].map((result) => result.payload?.ts)).toEqual([1000, 1001, 1002, 1003]);
    expect(restart.state.lastSubmission?.at).toBe(900); // Throttle clock is not the wire timestamp.
  });

  it('throttles ordinary metrics without queuing an old snapshot, then accepts the current snapshot at 250ms', () => {
    const first = planWatchTrackingPublication(initial(), snapshot(1000, true));
    const dropped = planWatchTrackingPublication(first.state, snapshot(1100, true, 99));
    expect(dropped.payload).toBeNull();
    expect(dropped.state).toBe(first.state);
    const next = planWatchTrackingPublication(dropped.state, snapshot(1250, true, 4));
    expect(next.payload?.reps).toBe(4);
    const duplicate = planWatchTrackingPublication(next.state, snapshot(1500, true, 4));
    expect(duplicate.payload).toBeNull();
    expect(duplicate.state).toBe(next.state);
  });

  it('flushes the latest Stop inside the metric throttle window without needing another frame', () => {
    const first = planWatchTrackingPublication(initial(), snapshot(1000, true));
    const beforeStop = first.state;
    const stopped = snapshot(1100, false, 3);
    const result = planWatchTrackingPublication(beforeStop, stopped);
    expect(result.payload).toEqual(stopped);
    expect(result.state.timestamp).toBe(1100);
    expect(beforeStop.timestamp).toBe(1000); // Pure: caller-owned state is not mutated.
    expect(first.payload?.isTracking).toBe(true);
  });
});
