export type MovementId = 'squat' | 'hinge' | 'lunge' | 'horizontal_press' | 'vertical_press';

export interface MovementThreshold {
  metric: string;
  min: number;
  max: number;
}

export interface MovementProfile {
  id: MovementId;
  displayName: string;
  thresholds: MovementThreshold[];
}

export const movementProfiles: Record<MovementId, MovementProfile> = {
  squat: {
    id: 'squat',
    displayName: 'Squat',
    thresholds: [
      { metric: 'kneeFlexionDeg', min: 80, max: 110 },
      { metric: 'trunkFromVerticalDeg', min: 8, max: 35 },
    ],
  },
  hinge: {
    id: 'hinge',
    displayName: 'Hinge',
    thresholds: [
      { metric: 'hipFlexionDeg', min: 45, max: 75 },
      { metric: 'kneeFlexionDeg', min: 145, max: 170 },
    ],
  },
  lunge: {
    id: 'lunge',
    displayName: 'Lunge',
    thresholds: [
      { metric: 'frontKneeFlexionDeg', min: 80, max: 110 },
      { metric: 'rearKneeFlexionDeg', min: 75, max: 115 },
    ],
  },
  horizontal_press: {
    id: 'horizontal_press',
    displayName: 'Horizontal Press',
    thresholds: [
      { metric: 'elbowFlexionDeg', min: 65, max: 110 },
      { metric: 'wristStackErrorDeg', min: 0, max: 12 },
    ],
  },
  vertical_press: {
    id: 'vertical_press',
    displayName: 'Vertical Press',
    thresholds: [
      { metric: 'elbowExtensionTopDeg', min: 160, max: 180 },
      { metric: 'ribFlareErrorDeg', min: 0, max: 15 },
    ],
  },
};

export function getMovementProfile(id: MovementId): MovementProfile {
  return movementProfiles[id];
}
