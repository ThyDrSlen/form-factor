import { getWorkoutByMode, getPhaseStaticCue, getWorkoutById, getWorkoutIds, isValidWorkoutId, isDetectionMode } from '@/lib/workouts';

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
