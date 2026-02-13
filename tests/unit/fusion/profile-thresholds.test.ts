import { getMovementProfile, movementProfiles } from '@/lib/fusion/movements';

describe('movement profiles', () => {
  test('contains all five launch movement profiles', () => {
    const keys = Object.keys(movementProfiles).sort();
    expect(keys).toEqual(['hinge', 'horizontal_press', 'lunge', 'squat', 'vertical_press']);
  });

  test('each profile provides deterministic threshold ranges', () => {
    const profiles = [
      getMovementProfile('squat'),
      getMovementProfile('hinge'),
      getMovementProfile('lunge'),
      getMovementProfile('horizontal_press'),
      getMovementProfile('vertical_press'),
    ];

    for (const profile of profiles) {
      expect(profile.thresholds.length).toBeGreaterThan(0);
      for (const threshold of profile.thresholds) {
        expect(threshold.min).toBeLessThanOrEqual(threshold.max);
      }
    }
  });
});
