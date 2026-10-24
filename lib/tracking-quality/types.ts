export type TrackingConfidenceTier = 'low' | 'medium' | 'high';

export interface TrackingConfidenceThresholds {
  low: number;
  medium: number;
}

export interface RepDetectorThresholds {
  liftStartDelta: number;
  liftTopDelta: number;
  liftTopExitDelta: number;
  liftBottomDelta: number;
  elbowEngageDeg: number;
  elbowTopDeg: number;
  elbowBottomDeg: number;
}

export interface TrackingQualityConfig {
  EMA_ALPHA_COORD: number;
  EMA_ALPHA_ANGLE: number;
  MAX_PX_PER_FRAME: number;
  SHOW_N_FRAMES: number;
  HIDE_N_FRAMES: number;
  HOLD_FRAMES: number;
  N_CONSEC_FRAMES: number;
  REP_DETECTOR_THRESHOLDS: RepDetectorThresholds;
  CONFIDENCE_TIER_THRESHOLDS: TrackingConfidenceThresholds;
}
