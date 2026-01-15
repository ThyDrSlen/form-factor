import { getWorkoutByMode, getWorkoutIds } from '@/lib/workouts';

test('dead_hang is registered as a detection mode', () => {
  expect(getWorkoutIds()).toContain('dead_hang');
});

test('dead_hang exposes a UI adapter', () => {
  const def = getWorkoutByMode('dead_hang');
  expect(def.id).toBe('dead_hang');
  expect(def.ui).toBeTruthy();
  expect(def.ui?.primaryMetric.key).toBeTruthy();
});

