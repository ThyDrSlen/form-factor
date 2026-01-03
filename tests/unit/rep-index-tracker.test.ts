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
