/**
 * Camera Placement Guide
 *
 * Per-exercise recommendations for phone position, distance, height,
 * tilt, lighting, and the top 2-3 pitfalls to warn the user about.
 *
 * Introduced by issue #479 to close the first-session confidence gap —
 * the new user who frames their camera wrong and doesn't find out until
 * tracking has already failed three times.
 *
 * This is a pure TypeScript service (no I/O) so it can be consumed from
 * components, hooks, tests, and analytics without any setup cost.
 *
 * Exercise coverage (14):
 *   - Core 8 (aligned with lib/workouts/): pullup, pushup, squat,
 *     deadlift, benchpress, dead_hang, rdl, farmers_walk
 *   - Extended catalog (UX surface only, no workout definition yet):
 *     ohp, lunge, hip_thrust, bss, barbell_row, lat_pulldown
 *
 * The exercise key uses the same `DetectionMode` string shape as
 * `lib/workouts/` for the first 8 entries. The extended 6 use the same
 * `snake_case` convention and live as a superset here until each gets a
 * workout definition.
 */

// =============================================================================
// Types
// =============================================================================

export type CameraOrientation = 'portrait' | 'landscape';

export type LightingHint =
  | 'bright_indoor'
  | 'even_ambient'
  | 'side_light_ok'
  | 'avoid_backlight';

export type PlacementGuideExerciseKey =
  // Core workouts matching lib/workouts/ DetectionMode ids
  | 'pullup'
  | 'pushup'
  | 'squat'
  | 'deadlift'
  | 'benchpress'
  | 'dead_hang'
  | 'rdl'
  | 'farmers_walk'
  // Extended catalog (UX surface only until workout defs land)
  | 'ohp'
  | 'lunge'
  | 'hip_thrust'
  | 'bss'
  | 'barbell_row'
  | 'lat_pulldown';

export interface CameraPlacementGuide {
  /** Stable key matching workout DetectionMode or extended catalog id. */
  key: PlacementGuideExerciseKey;
  /** Human-readable exercise name. */
  displayName: string;
  /** Recommended phone orientation. */
  orientation: CameraOrientation;
  /** Camera distance from user in meters. */
  distanceM: number;
  /** Camera height (lens midpoint) above floor in meters. */
  heightM: number;
  /** Camera tilt in degrees from vertical (+ = leans forward/up toward user). */
  tiltDeg: number;
  /** Lighting recommendation (controlled vocab for iconography). */
  lightingHint: LightingHint;
  /** Short pitfalls list (2-3 items) surfaced in the UI. */
  commonPitfalls: string[];
  /** One-line summary for card headers. */
  summary: string;
}

// =============================================================================
// Data
// =============================================================================

/**
 * Canonical guide entries. Ordering is stable — UI callers should not
 * depend on insertion order.
 *
 * Values are derived from internal form-tracking usability sessions and
 * ARKit sample frame requirements (roughly full-body in frame with ~10%
 * headroom; side angle preferred for compound lifts).
 */
const GUIDES: Record<PlacementGuideExerciseKey, CameraPlacementGuide> = {
  pullup: {
    key: 'pullup',
    displayName: 'Pull-up',
    orientation: 'portrait',
    distanceM: 2.4,
    heightM: 1.2,
    tiltDeg: 10,
    lightingHint: 'bright_indoor',
    commonPitfalls: [
      'Bar cuts off the top of the frame — step back or lower the phone',
      'Backlight from a window washes out joint tracking',
      'Phone tilted too far up loses your hips',
    ],
    summary: 'Portrait, about 2.4 m back, lens roughly at chest height.',
  },
  pushup: {
    key: 'pushup',
    displayName: 'Push-up',
    orientation: 'landscape',
    distanceM: 1.8,
    heightM: 0.35,
    tiltDeg: 0,
    lightingHint: 'even_ambient',
    commonPitfalls: [
      'Phone too high — you lose the hip-shoulder line',
      'Feet get clipped out of frame',
      'Carpet glare washes out elbow joints',
    ],
    summary: 'Landscape, side view at floor-level, framing head to toes.',
  },
  squat: {
    key: 'squat',
    displayName: 'Squat',
    orientation: 'portrait',
    distanceM: 2.2,
    heightM: 0.9,
    tiltDeg: 5,
    lightingHint: 'even_ambient',
    commonPitfalls: [
      'Angled front view hides knee tracking — go 30-45° side on',
      'Mirror behind you confuses the pose model',
      'Loose clothing obscures hips at depth',
    ],
    summary: 'Portrait, 30-45° side view, lens at waist height.',
  },
  deadlift: {
    key: 'deadlift',
    displayName: 'Deadlift',
    orientation: 'landscape',
    distanceM: 2.6,
    heightM: 0.5,
    tiltDeg: 0,
    lightingHint: 'side_light_ok',
    commonPitfalls: [
      'Bar plates occlude your front thigh on head-on framing',
      'Phone too high shows bar path but loses back angle',
      'Rack or rig shadows across your torso',
    ],
    summary: 'Landscape, pure side view, lens near knee height.',
  },
  benchpress: {
    key: 'benchpress',
    displayName: 'Bench press',
    orientation: 'landscape',
    distanceM: 1.6,
    heightM: 0.6,
    tiltDeg: 5,
    lightingHint: 'avoid_backlight',
    commonPitfalls: [
      'Rack uprights cover your shoulder — shift the phone forward',
      'Overhead light creates harsh bar shadow on chest',
      'Phone too low misses elbow angle at lockout',
    ],
    summary: 'Landscape, side view near bench height, about 1.6 m away.',
  },
  dead_hang: {
    key: 'dead_hang',
    displayName: 'Dead hang',
    orientation: 'portrait',
    distanceM: 2.0,
    heightM: 1.4,
    tiltDeg: 15,
    lightingHint: 'bright_indoor',
    commonPitfalls: [
      'Lens too high — your hands vanish above the frame',
      'Swinging outside the frame triggers false tracking-loss',
      'Dark corner under a bar loses hip landmarks',
    ],
    summary: 'Portrait, about 2 m back, lens near shoulder height.',
  },
  rdl: {
    key: 'rdl',
    displayName: 'Romanian deadlift',
    orientation: 'landscape',
    distanceM: 2.4,
    heightM: 0.7,
    tiltDeg: 0,
    lightingHint: 'even_ambient',
    commonPitfalls: [
      'Hip hinge is a side-on movement — don\'t film from the front',
      'Bar hides ankle joints — keep camera low',
      'Baggy shorts hide hip hinge depth',
    ],
    summary: 'Landscape, side view at hip height, about 2.4 m away.',
  },
  farmers_walk: {
    key: 'farmers_walk',
    displayName: 'Farmers walk',
    orientation: 'landscape',
    distanceM: 3.2,
    heightM: 1.0,
    tiltDeg: 0,
    lightingHint: 'even_ambient',
    commonPitfalls: [
      'You walk out of frame — pick a fixed start and stop line',
      'Panning the phone ruins the calibration reference',
      'Implements swing and cover thigh tracking',
    ],
    summary: 'Landscape, fixed camera at chest height, 3+ m away.',
  },
  ohp: {
    key: 'ohp',
    displayName: 'Overhead press',
    orientation: 'portrait',
    distanceM: 2.2,
    heightM: 1.3,
    tiltDeg: 10,
    lightingHint: 'avoid_backlight',
    commonPitfalls: [
      'Bar leaves the frame at lockout — tilt up slightly',
      'Rack uprights cut through your torso',
      'Ceiling light behind you creates silhouette effect',
    ],
    summary: 'Portrait, 2.2 m back, lens at chest height, slight upward tilt.',
  },
  lunge: {
    key: 'lunge',
    displayName: 'Lunge',
    orientation: 'landscape',
    distanceM: 2.4,
    heightM: 0.6,
    tiltDeg: 0,
    lightingHint: 'even_ambient',
    commonPitfalls: [
      'Walking lunges leave the frame — do reverse or stationary',
      'Knee-over-toe obscured by front-on framing',
      'Floor glare near the back foot',
    ],
    summary: 'Landscape, pure side view, lens at hip height.',
  },
  hip_thrust: {
    key: 'hip_thrust',
    displayName: 'Hip thrust',
    orientation: 'landscape',
    distanceM: 1.8,
    heightM: 0.35,
    tiltDeg: 0,
    lightingHint: 'even_ambient',
    commonPitfalls: [
      'Bench blocks the hip joint — camera must be lower than the bench',
      'Overhead shot misses lockout extension',
      'Loose clothing hides hip line at the top',
    ],
    summary: 'Landscape, side view slightly below bench height.',
  },
  bss: {
    key: 'bss',
    displayName: 'Bulgarian split squat',
    orientation: 'portrait',
    distanceM: 2.0,
    heightM: 0.8,
    tiltDeg: 5,
    lightingHint: 'even_ambient',
    commonPitfalls: [
      'Rear foot bench occludes back leg — keep bench flush with frame edge',
      'Front-on framing hides knee valgus',
      'Dumbbells swing and clip the frame',
    ],
    summary: 'Portrait, 30-45° side view at hip height, 2 m back.',
  },
  barbell_row: {
    key: 'barbell_row',
    displayName: 'Barbell row',
    orientation: 'landscape',
    distanceM: 2.2,
    heightM: 0.5,
    tiltDeg: 0,
    lightingHint: 'side_light_ok',
    commonPitfalls: [
      'Plates block your torso from front-on — side view only',
      'Phone too high misses hip hinge angle',
      'Dark floor washes out feet landmarks',
    ],
    summary: 'Landscape, pure side view, lens near knee height.',
  },
  lat_pulldown: {
    key: 'lat_pulldown',
    displayName: 'Lat pulldown',
    orientation: 'portrait',
    distanceM: 1.8,
    heightM: 1.1,
    tiltDeg: 0,
    lightingHint: 'bright_indoor',
    commonPitfalls: [
      'Cable machine blocks the bar path from behind — go 45° off angle',
      'Lens too low misses bar-to-chest alignment',
      'Seat cushion hides hip posture',
    ],
    summary: 'Portrait, 45° side view at chest height.',
  },
};

// =============================================================================
// Public API
// =============================================================================

/** Get the placement guide for an exercise, or null if no guide exists. */
export function getPlacementGuide(key: string): CameraPlacementGuide | null {
  return (GUIDES as Record<string, CameraPlacementGuide>)[key] ?? null;
}

/** List every exercise key that has a placement guide. */
export function getPlacementGuideKeys(): PlacementGuideExerciseKey[] {
  return Object.keys(GUIDES) as PlacementGuideExerciseKey[];
}

/** Return all guides as an array (stable iteration order). */
export function getAllPlacementGuides(): CameraPlacementGuide[] {
  return getPlacementGuideKeys().map((key) => GUIDES[key]);
}

/** Check if a given key has a registered guide. */
export function hasPlacementGuide(key: string): key is PlacementGuideExerciseKey {
  return key in GUIDES;
}

/**
 * Human-friendly label for a lighting hint. Exposed so components can
 * render consistent copy without re-declaring the mapping.
 */
export function describeLighting(hint: LightingHint): string {
  switch (hint) {
    case 'bright_indoor':
      return 'Bright indoor lighting';
    case 'even_ambient':
      return 'Even ambient lighting';
    case 'side_light_ok':
      return 'Side lighting is fine';
    case 'avoid_backlight':
      return 'Avoid backlight / window behind you';
    default: {
      const _exhaustive: never = hint;
      return String(_exhaustive);
    }
  }
}
