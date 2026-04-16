import {
  getWorkoutByMode,
  getPhaseStaticCue,
  getWorkoutIds,
  getWorkoutById,
  isValidWorkoutId,
  isDetectionMode,
  workoutsByMode,
  workoutRegistry,
} from '@/lib/workouts';

// ---------------------------------------------------------------------------
// Existing coverage (kept)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// New coverage — 6 added modes from #459
// ---------------------------------------------------------------------------

describe('new detection modes (#459) are registered', () => {
  const NEW_MODES: Array<{ mode: keyof typeof workoutsByMode; id: string }> = [
    { mode: 'hip_thrust', id: 'hip_thrust' },
    { mode: 'bulgarian_split_squat', id: 'bulgarian_split_squat' },
    { mode: 'barbell_row', id: 'barbell_row' },
    { mode: 'lat_pulldown', id: 'lat_pulldown' },
    { mode: 'overhead_press', id: 'overhead_press' },
    { mode: 'dumbbell_curl', id: 'dumbbell_curl' },
  ];

  for (const { mode, id } of NEW_MODES) {
    test(`getWorkoutByMode returns the ${mode} definition`, () => {
      const def = getWorkoutByMode(mode);
      expect(def.id).toBe(id);
      expect(def.displayName.length).toBeGreaterThan(0);
    });

    test(`${mode} registers >= 1 fault and a non-empty phases array`, () => {
      const def = getWorkoutByMode(mode);
      expect(def.faults.length).toBeGreaterThan(0);
      expect(def.phases.length).toBeGreaterThan(0);
      expect(def.thresholds).toBeTruthy();
    });

    test(`isDetectionMode('${mode}') is true`, () => {
      expect(isDetectionMode(mode)).toBe(true);
    });

    test(`isValidWorkoutId('${id}') is true`, () => {
      expect(isValidWorkoutId(id)).toBe(true);
    });

    test(`getWorkoutById('${id}') returns the definition`, () => {
      const def = getWorkoutById(id);
      expect(def).toBeTruthy();
      expect(def?.id).toBe(id);
    });
  }

  test('all 6 new modes appear in getWorkoutIds()', () => {
    const ids = getWorkoutIds();
    for (const { mode } of NEW_MODES) {
      expect(ids).toContain(mode);
    }
  });

  test('workoutRegistry contains all 6 new definitions', () => {
    for (const { id } of NEW_MODES) {
      expect(workoutRegistry[id]).toBeTruthy();
    }
  });

  test('DetectionMode union expands to 14 keys (8 existing + 6 new)', () => {
    expect(getWorkoutIds().length).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// Negative guards — unrelated strings do NOT pass the registry
// ---------------------------------------------------------------------------

describe('registry guards reject unknown ids', () => {
  test('isDetectionMode rejects unknown mode', () => {
    expect(isDetectionMode('not_a_workout')).toBe(false);
  });

  test('isValidWorkoutId rejects unknown id', () => {
    expect(isValidWorkoutId('not_a_workout')).toBe(false);
  });

  test('getWorkoutById returns undefined for unknown id', () => {
    expect(getWorkoutById('not_a_workout')).toBeUndefined();
  });
});
