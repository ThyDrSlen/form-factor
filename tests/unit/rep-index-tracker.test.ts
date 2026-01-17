import { RepIndexTracker } from '@/lib/services/rep-index-tracker';

test('RepIndexTracker assigns 1-indexed active rep and clears on end', () => {
  const tracker = new RepIndexTracker();
  expect(tracker.current()).toBeNull();
  expect(tracker.startRep(0)).toBe(1);
  expect(tracker.current()).toBe(1);
  expect(tracker.endRep()).toBe(1);
  expect(tracker.current()).toBeNull();
});

test('RepIndexTracker increments based on completed count', () => {
  const tracker = new RepIndexTracker();
  expect(tracker.startRep(5)).toBe(6);
});

test('RepIndexTracker returns null when ending without active rep', () => {
  const tracker = new RepIndexTracker();
  expect(tracker.endRep()).toBeNull();
});

test('RepIndexTracker reset clears active rep', () => {
  const tracker = new RepIndexTracker();
  tracker.startRep(1);
  tracker.reset();
  expect(tracker.current()).toBeNull();
});

test('RepIndexTracker startRep overwrites active rep', () => {
  const tracker = new RepIndexTracker();
  expect(tracker.startRep(1)).toBe(2);
  expect(tracker.startRep(5)).toBe(6);
  expect(tracker.current()).toBe(6);
});

test('RepIndexTracker endRep called twice returns null second time', () => {
  const tracker = new RepIndexTracker();
  tracker.startRep(1);
  expect(tracker.endRep()).toBe(2);
  expect(tracker.endRep()).toBeNull();
});

test('RepIndexTracker handles multiple complete cycles', () => {
  const tracker = new RepIndexTracker();
  expect(tracker.startRep(0)).toBe(1);
  expect(tracker.endRep()).toBe(1);
  expect(tracker.startRep(1)).toBe(2);
  expect(tracker.endRep()).toBe(2);
  expect(tracker.startRep(2)).toBe(3);
  expect(tracker.endRep()).toBe(3);
  expect(tracker.current()).toBeNull();
});

test('RepIndexTracker handles negative completedCount', () => {
  const tracker = new RepIndexTracker();
  expect(tracker.startRep(-1)).toBe(0);
  expect(tracker.startRep(-5)).toBe(-4);
});
