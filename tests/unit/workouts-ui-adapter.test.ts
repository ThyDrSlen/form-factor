import { getWorkoutByMode, getWorkoutIds } from '@/lib/workouts';

test('every workout definition provides a ui adapter', () => {
  for (const mode of getWorkoutIds()) {
    const def = getWorkoutByMode(mode);
    expect(def.ui).toBeTruthy();
    expect(def.ui?.iconName).toBeTruthy();
    expect(def.ui?.primaryMetric).toEqual(
      expect.objectContaining({ key: expect.any(String), label: expect.any(String), format: expect.any(String) })
    );
    expect(typeof def.ui?.buildUploadMetrics).toBe('function');
    expect(typeof def.ui?.buildWatchMetrics).toBe('function');
  }
});

