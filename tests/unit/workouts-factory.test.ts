import { getWorkoutByMode, getPhaseStaticCue } from '@/lib/workouts';

test('getWorkoutByMode returns pullup definition', () => {
  const def = getWorkoutByMode('pullup');
  expect(def.id).toBe('pullup');
  expect(def.displayName).toBeTruthy();
});

test('getWorkoutByMode returns benchpress definition', () => {
  const def = getWorkoutByMode('benchpress');
  expect(def.id).toBe('benchpress');
  expect(def.displayName).toBeTruthy();
});

test('getPhaseStaticCue returns a cue for initial phase', () => {
  const def = getWorkoutByMode('pushup');
  const cue = getPhaseStaticCue(def, def.initialPhase);
  expect(cue).toBeTruthy();
  expect((cue ?? '').length).toBeGreaterThan(0);
});
