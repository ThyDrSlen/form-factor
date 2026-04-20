/**
 * Mobility Drills Library
 *
 * Curated list of between-set mobility drills keyed loosely by muscle
 * group. Picker matches an exercise's `muscle_group` string against
 * drill tags and picks one that fits the remaining rest window.
 */

export type MobilityDrillId =
  | 'thoracic-opener'
  | 'scap-wall-slide'
  | 'cat-cow'
  | 'hip-90-90'
  | 'hamstring-float'
  | 'ankle-rocker'
  | 'dead-bug'
  | 'band-pull-apart'
  | 'doorway-pec-stretch'
  | 'couch-stretch';

export type MobilityIntensity = 'low' | 'moderate';

export interface MobilityDrill {
  id: MobilityDrillId;
  name: string;
  description: string;
  /**
   * Lowercase substrings to match against the Exercise.muscle_group field.
   * Picker returns the first drill whose tags contain the muscle group.
   */
  muscleTags: readonly string[];
  steps: readonly string[];
  durationSeconds: number;
  intensity: MobilityIntensity;
}

export const MOBILITY_DRILLS: readonly MobilityDrill[] = [
  {
    id: 'thoracic-opener',
    name: 'Thoracic Spine Opener',
    description: 'Wakes up mid-back extension before pressing or pulling.',
    muscleTags: ['chest', 'shoulders', 'back', 'upper'],
    steps: [
      'Kneel on the floor with hands behind your head.',
      'Rotate elbow toward the ceiling, opening one side of the chest.',
      'Return and alternate sides smoothly for 6 reps per side.',
    ],
    durationSeconds: 45,
    intensity: 'low',
  },
  {
    id: 'scap-wall-slide',
    name: 'Scapular Wall Slide',
    description: 'Primes overhead mechanics and shoulder stability.',
    muscleTags: ['shoulders', 'back', 'upper', 'chest'],
    steps: [
      'Stand with back flat against a wall.',
      'Press arms into the wall in a "W" shape.',
      'Slide arms overhead into a "Y", keeping contact with the wall.',
      'Control the return. 8 slow reps.',
    ],
    durationSeconds: 40,
    intensity: 'low',
  },
  {
    id: 'cat-cow',
    name: 'Cat-Cow Flow',
    description: 'Restores spinal segmentation and relaxes bracing muscles.',
    muscleTags: ['back', 'core', 'spine', 'lower-back'],
    steps: [
      'Start on all fours, hands under shoulders.',
      'Inhale: drop belly, lift chest and tailbone (cow).',
      'Exhale: round back, tuck chin and tailbone (cat).',
      '6 slow cycles matching breath.',
    ],
    durationSeconds: 40,
    intensity: 'low',
  },
  {
    id: 'hip-90-90',
    name: '90/90 Hip Switch',
    description: 'Opens internal and external hip rotation for squat patterns.',
    muscleTags: ['glutes', 'hips', 'legs', 'quads', 'lower'],
    steps: [
      'Sit with one leg bent in front at 90 degrees, other leg bent behind at 90.',
      'Keeping torso tall, rotate knees across to switch sides.',
      'Pause 2 seconds on each side. 5 switches per side.',
    ],
    durationSeconds: 50,
    intensity: 'moderate',
  },
  {
    id: 'hamstring-float',
    name: 'Active Hamstring Float',
    description: 'Wakes posterior chain without fatiguing it.',
    muscleTags: ['hamstrings', 'glutes', 'lower', 'legs'],
    steps: [
      'Stand tall, hinge forward keeping back neutral.',
      'Tap fingers to shins or toes, return under control.',
      '6 slow reps — no bouncing.',
    ],
    durationSeconds: 35,
    intensity: 'low',
  },
  {
    id: 'ankle-rocker',
    name: 'Ankle Rocker',
    description: 'Restores ankle dorsiflexion before squats and deadlifts.',
    muscleTags: ['calves', 'ankles', 'legs', 'quads', 'lower'],
    steps: [
      'Split stance, front knee bent over toe.',
      'Drive knee forward past the toe, keeping heel down.',
      '8 rocks per side.',
    ],
    durationSeconds: 35,
    intensity: 'low',
  },
  {
    id: 'dead-bug',
    name: 'Dead Bug',
    description: 'Reinforces anti-extension bracing between compound sets.',
    muscleTags: ['core', 'abs', 'full-body'],
    steps: [
      'Lie on back, arms up, knees at 90.',
      'Lower opposite arm and leg until just above the floor.',
      'Return and switch. Keep lower back pressed down. 4 per side.',
    ],
    durationSeconds: 40,
    intensity: 'moderate',
  },
  {
    id: 'band-pull-apart',
    name: 'Band Pull-Apart',
    description: 'Activates rear delts and mid-traps before pressing work.',
    muscleTags: ['back', 'shoulders', 'upper', 'chest'],
    steps: [
      'Hold a light band at shoulder height, arms straight.',
      'Pull band apart by squeezing shoulder blades.',
      'Control the return. 10 reps.',
    ],
    durationSeconds: 30,
    intensity: 'low',
  },
  {
    id: 'doorway-pec-stretch',
    name: 'Doorway Pec Stretch',
    description: 'Lengthens pecs after pressing to restore posture.',
    muscleTags: ['chest', 'shoulders', 'upper'],
    steps: [
      'Place forearm on a doorway at shoulder height.',
      'Step forward until a mild stretch is felt across the chest.',
      'Hold 20 seconds each side.',
    ],
    durationSeconds: 45,
    intensity: 'low',
  },
  {
    id: 'couch-stretch',
    name: 'Couch Stretch',
    description: 'Opens hip flexors before squats, lunges, or deadlifts.',
    muscleTags: ['quads', 'hips', 'legs', 'lower'],
    steps: [
      'Place back foot on a bench or couch, front foot forward.',
      'Square hips and tuck tailbone to stretch the back hip.',
      'Hold 20 seconds each side.',
    ],
    durationSeconds: 50,
    intensity: 'moderate',
  },
] as const;

const FULL_BODY_FALLBACK: MobilityDrill = {
  id: 'cat-cow',
  name: 'Cat-Cow Flow',
  description: 'Restores spinal segmentation and relaxes bracing muscles.',
  muscleTags: ['full-body'],
  steps: [
    'Start on all fours, hands under shoulders.',
    'Inhale: drop belly, lift chest and tailbone (cow).',
    'Exhale: round back, tuck chin and tailbone (cat).',
    '6 slow cycles matching breath.',
  ],
  durationSeconds: 40,
  intensity: 'low',
};

export function getMobilityDrill(id: MobilityDrillId): MobilityDrill {
  const drill = MOBILITY_DRILLS.find((d) => d.id === id);
  if (!drill) {
    throw new Error(`Unknown mobility drill: ${id}`);
  }
  return drill;
}

function normalizeMuscleGroup(muscleGroup: string | null | undefined): string {
  return (muscleGroup ?? '').toLowerCase().trim();
}

export interface PickMobilityInput {
  muscleGroup: string | null | undefined;
  restSeconds: number;
  previouslyShownIds?: readonly MobilityDrillId[];
}

export function pickMobilityDrill(input: PickMobilityInput): MobilityDrill {
  const normalized = normalizeMuscleGroup(input.muscleGroup);
  const exclude = new Set(input.previouslyShownIds ?? []);
  const fitsRest = (drill: MobilityDrill) =>
    input.restSeconds <= 0 || drill.durationSeconds <= input.restSeconds;

  if (normalized) {
    const matching = MOBILITY_DRILLS.filter(
      (d) =>
        d.muscleTags.some((tag) => normalized.includes(tag)) && !exclude.has(d.id) && fitsRest(d),
    );
    if (matching.length > 0) {
      return matching[0];
    }
  }

  const notExcluded = MOBILITY_DRILLS.filter((d) => !exclude.has(d.id) && fitsRest(d));
  if (notExcluded.length > 0) {
    return notExcluded[0];
  }

  return FULL_BODY_FALLBACK;
}
