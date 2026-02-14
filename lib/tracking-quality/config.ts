import type { RepDetectorThresholds, TrackingConfidenceTier, TrackingQualityConfig } from './types';

export const EMA_ALPHA_COORD = 0.35;
export const EMA_ALPHA_ANGLE = 0.24;
export const MAX_PX_PER_FRAME = 36;
export const SHOW_N_FRAMES = 2;
export const HIDE_N_FRAMES = 3;
export const HOLD_FRAMES = 4;
export const N_CONSEC_FRAMES = 3;
export const REP_DETECTOR_THRESHOLDS: RepDetectorThresholds = {
  liftStartDelta: 0.05,
  liftTopDelta: 0.14,
  liftTopExitDelta: 0.11,
  liftBottomDelta: 0.03,
  elbowEngageDeg: 140,
  elbowTopDeg: 90,
  elbowBottomDeg: 150,
};
export const CONFIDENCE_TIER_THRESHOLDS = {
  low: 0.3,
  medium: 0.6,
} as const;

export const TRACKING_QUALITY_CONFIG: TrackingQualityConfig = {
  EMA_ALPHA_COORD,
  EMA_ALPHA_ANGLE,
  MAX_PX_PER_FRAME,
  SHOW_N_FRAMES,
  HIDE_N_FRAMES,
  HOLD_FRAMES,
  N_CONSEC_FRAMES,
  REP_DETECTOR_THRESHOLDS,
  CONFIDENCE_TIER_THRESHOLDS,
};

export function getConfidenceTier(score: number): TrackingConfidenceTier {
  if (score < CONFIDENCE_TIER_THRESHOLDS.low) {
    return 'low';
  }
  if (score < CONFIDENCE_TIER_THRESHOLDS.medium) {
    return 'medium';
  }
  return 'high';
}
