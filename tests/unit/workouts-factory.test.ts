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

test('getWorkoutByMode returns pullup definition with complete metadata', () => {
  const def = getWorkoutByMode('pullup');
  expect(def.id).toBe('pullup');
  // Stricter: exact-match metadata, not just truthiness.
  expect(def.displayName).toBe('Pull-Up');
  expect(def.category).toBe('upper_body');
  expect(def.difficulty).toBe('intermediate');
  expect(def.initialPhase).toBe('idle');
});

test('getWorkoutByMode returns benchpress definition with complete metadata', () => {
  const def = getWorkoutByMode('benchpress');
  expect(def.id).toBe('benchpress');
  expect(def.displayName).toBe('Bench Press');
  expect(def.category).toBe('upper_body');
  expect(def.difficulty).toBe('intermediate');
  expect(def.initialPhase).toBe('setup');
});

test('getPhaseStaticCue returns a specific cue for initial phase (pushup setup)', () => {
  const def = getWorkoutByMode('pushup');
  const cue = getPhaseStaticCue(def, def.initialPhase);
  // Rationale: the setup cue for pushup has to mention hands/plank — asserting
  // a non-empty string was too loose and silently accepted stubs/whitespace.
  expect(typeof cue).toBe('string');
  expect(cue).toMatch(/plank|hands|shoulders|glutes/i);
  // Must match the cue text declared in the definition (single source of truth).
  const declared = def.phases.find((p) => p.id === def.initialPhase)!.staticCue;
  expect(cue).toBe(declared);
});

test('getPhaseStaticCue returns null for unknown phase ids', () => {
  const def = getWorkoutByMode('pullup');
  expect(getPhaseStaticCue(def, 'does-not-exist')).toBeNull();
});

test('getWorkoutById returns same reference as getWorkoutByMode for valid ids', () => {
  for (const id of getWorkoutIds()) {
    const a = getWorkoutByMode(id);
    const b = getWorkoutById(id);
    expect(b).toBe(a);
  }
});

test('getWorkoutById returns undefined for unknown ids', () => {
  expect(getWorkoutById('not-a-real-workout')).toBeUndefined();
});

test('isValidWorkoutId / isDetectionMode agree with the registry', () => {
  const ids = getWorkoutIds();
  expect(ids.length).toBeGreaterThanOrEqual(8); // we ship at least 8 workouts
  for (const id of ids) {
    expect(isValidWorkoutId(id)).toBe(true);
    expect(isDetectionMode(id)).toBe(true);
  }
  expect(isValidWorkoutId('foo')).toBe(false);
  expect(isDetectionMode('foo')).toBe(false);
});

test('every workout definition ships a non-empty cue for every phase it declares', () => {
  for (const id of getWorkoutIds()) {
    const def = getWorkoutByMode(id);
    for (const phase of def.phases) {
      // The static cue is part of the coach UX contract — missing/empty cues
      // are a silent regression a toBeTruthy() would have accepted ("" is
      // truthy in some edge cases, and " " is always truthy).
      expect(typeof phase.staticCue).toBe('string');
      expect(phase.staticCue.trim().length).toBeGreaterThan(5);
    }
  }
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

  test('DetectionMode union expands to 15 keys (8 existing + 6 new from #459 + lunge from #441)', () => {
    expect(getWorkoutIds().length).toBe(15);
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
