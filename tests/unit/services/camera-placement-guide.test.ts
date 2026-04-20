/**
 * Unit tests for camera-placement-guide data integrity.
 *
 * Acceptance criterion from issue #479:
 *   "Camera guide SVG renders correctly for all 14 exercises"
 *
 * This test file proves the underlying data contract — each of the 14
 * exercises has a complete, well-formed guide. The SVG renderer has its
 * own component-level tests.
 */

import {
  describeLighting,
  getAllPlacementGuides,
  getPlacementGuide,
  getPlacementGuideKeys,
  hasPlacementGuide,
  type CameraPlacementGuide,
  type PlacementGuideExerciseKey,
} from '@/lib/services/camera-placement-guide';

const EXPECTED_EXERCISE_KEYS: PlacementGuideExerciseKey[] = [
  'pullup',
  'pushup',
  'squat',
  'deadlift',
  'benchpress',
  'dead_hang',
  'rdl',
  'farmers_walk',
  'ohp',
  'lunge',
  'hip_thrust',
  'bss',
  'barbell_row',
  'lat_pulldown',
];

describe('camera-placement-guide — coverage', () => {
  it('contains exactly the 14 expected exercises', () => {
    const keys = getPlacementGuideKeys();
    expect(keys).toHaveLength(14);
    expect(new Set(keys)).toEqual(new Set(EXPECTED_EXERCISE_KEYS));
  });

  it('getAllPlacementGuides returns one guide per exercise', () => {
    const guides = getAllPlacementGuides();
    expect(guides).toHaveLength(14);
    const keysFromArray = guides.map((g) => g.key);
    expect(new Set(keysFromArray)).toEqual(new Set(EXPECTED_EXERCISE_KEYS));
  });
});

describe('camera-placement-guide — getPlacementGuide()', () => {
  it('returns a complete guide for every expected key', () => {
    for (const key of EXPECTED_EXERCISE_KEYS) {
      const guide = getPlacementGuide(key);
      expect(guide).not.toBeNull();
      if (!guide) continue;

      expect(guide.key).toBe(key);
      expect(guide.displayName).toMatch(/\w+/);
      expect(['portrait', 'landscape']).toContain(guide.orientation);
      expect(guide.distanceM).toBeGreaterThan(0.5);
      expect(guide.distanceM).toBeLessThan(6);
      expect(guide.heightM).toBeGreaterThanOrEqual(0.2);
      expect(guide.heightM).toBeLessThan(2);
      expect(guide.tiltDeg).toBeGreaterThanOrEqual(-20);
      expect(guide.tiltDeg).toBeLessThanOrEqual(30);
      expect(guide.commonPitfalls.length).toBeGreaterThanOrEqual(2);
      expect(guide.commonPitfalls.length).toBeLessThanOrEqual(3);
      expect(guide.summary.length).toBeGreaterThan(10);
    }
  });

  it('returns null for unknown keys', () => {
    expect(getPlacementGuide('bogus_exercise')).toBeNull();
    expect(getPlacementGuide('')).toBeNull();
  });
});

describe('camera-placement-guide — hasPlacementGuide()', () => {
  it('narrows to PlacementGuideExerciseKey for known keys', () => {
    expect(hasPlacementGuide('pullup')).toBe(true);
    expect(hasPlacementGuide('squat')).toBe(true);
    expect(hasPlacementGuide('lat_pulldown')).toBe(true);
  });

  it('returns false for unknown keys', () => {
    expect(hasPlacementGuide('burpee')).toBe(false);
    expect(hasPlacementGuide('')).toBe(false);
  });
});

describe('camera-placement-guide — describeLighting()', () => {
  it('provides a non-empty human string for every hint', () => {
    const guides = getAllPlacementGuides();
    const hintsSeen = new Set<CameraPlacementGuide['lightingHint']>();
    for (const g of guides) hintsSeen.add(g.lightingHint);

    for (const hint of hintsSeen) {
      const copy = describeLighting(hint);
      expect(copy.length).toBeGreaterThan(5);
    }
  });

  it('covers all four controlled-vocab values', () => {
    expect(describeLighting('bright_indoor')).toMatch(/bright/i);
    expect(describeLighting('even_ambient')).toMatch(/even/i);
    expect(describeLighting('side_light_ok')).toMatch(/side/i);
    expect(describeLighting('avoid_backlight')).toMatch(/backlight/i);
  });
});

describe('camera-placement-guide — cross-check core workouts', () => {
  it('covers all 8 DetectionMode ids used by lib/workouts/', () => {
    const coreWorkoutIds = [
      'pullup',
      'pushup',
      'squat',
      'deadlift',
      'benchpress',
      'dead_hang',
      'rdl',
      'farmers_walk',
    ];
    for (const id of coreWorkoutIds) {
      expect(hasPlacementGuide(id)).toBe(true);
    }
  });
});
