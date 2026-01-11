import { getFormScore, getPrimaryCue } from '@/lib/video-feed';

test('getFormScore supports benchpress metrics', () => {
  const score = getFormScore(
    {
      mode: 'benchpress',
      reps: 6,
      avgElbowDeg: 95,
      avgShoulderDeg: 105,
    } as any,
    'Bench Press'
  );
  expect(score).not.toBeNull();
});

test('getPrimaryCue supports benchpress elbow flare cue', () => {
  const cue = getPrimaryCue(
    {
      mode: 'benchpress',
      reps: 3,
      avgElbowDeg: 105,
      avgShoulderDeg: 130,
    } as any,
    'Bench Press'
  );
  expect(cue).toBe('Tuck elbows slightly to protect your shoulders.');
});

