import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RealtimeFormEngineOutput, RealtimeFormEngineState } from '@/lib/pose/realtime-form-engine';

export type TrackingConfidenceTier = 'low' | 'medium' | 'high';

export type TrackingPipelineMode = 'legacy' | 'new';

export interface TrackingConfidenceThresholds {
  low: number;
  medium: number;
}

export interface TrackingQualityConfig {
  EMA_ALPHA_COORD: number;
  EMA_ALPHA_ANGLE: number;
  MAX_PX_PER_FRAME: number;
  SHOW_N_FRAMES: number;
  HIDE_N_FRAMES: number;
  HOLD_FRAMES: number;
  CONFIDENCE_TIER_THRESHOLDS: TrackingConfidenceThresholds;
}

export interface TrackingPipelineFlags {
  useNewTrackingPipeline: boolean;
  mode: TrackingPipelineMode;
}

export interface TrackingQualityPipeline {
  mode: TrackingPipelineMode;
  createState: () => RealtimeFormEngineState;
  processAngles: (input: {
    state: RealtimeFormEngineState;
    angles: JointAngles;
    valid: Record<keyof JointAngles, boolean>;
    timestampSec: number;
    shadowMeanAbsDelta?: number | null;
  }) => RealtimeFormEngineOutput;
}
