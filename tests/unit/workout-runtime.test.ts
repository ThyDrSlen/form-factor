import { shouldStartRep, shouldEndRep } from '@/lib/services/workout-runtime';
import type { RepBoundary } from '@/lib/types/workout-definitions';

test('rep starts on transition into startPhase', () => {
  const boundary: RepBoundary<'a' | 'b'> = { startPhase: 'a', endPhase: 'b', minDurationMs: 400 };
  expect(shouldStartRep(boundary, 'b', 'a')).toBe(true);
  expect(shouldStartRep(boundary, 'a', 'a')).toBe(false);
});

test('rep ends on transition into endPhase after debounce', () => {
  const boundary: RepBoundary<'a' | 'b'> = { startPhase: 'a', endPhase: 'b', minDurationMs: 400 };
  expect(shouldEndRep(boundary, 'a', 'b', true, 1000, 0)).toBe(true);
  expect(shouldEndRep(boundary, 'a', 'b', true, 200, 0)).toBe(false);
});
