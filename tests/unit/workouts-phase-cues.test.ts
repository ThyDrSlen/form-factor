import { getWorkoutByMode, getPhaseStaticCue } from '@/lib/workouts';

test('getPhaseStaticCue works with dynamic phase id string', () => {
  const def = getWorkoutByMode('pullup');
  const phaseId: string = def.initialPhase;
  expect(getPhaseStaticCue(def, phaseId)).toBeTruthy();
});

