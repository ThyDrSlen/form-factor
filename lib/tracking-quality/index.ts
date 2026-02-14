import {
  createRealtimeFormEngineState,
  processRealtimeAngles,
  type RealtimeFormEngineOutput,
  type RealtimeFormEngineState,
} from '@/lib/pose/realtime-form-engine';
import {
  CONFIDENCE_TIER_THRESHOLDS,
  EMA_ALPHA_ANGLE,
  EMA_ALPHA_COORD,
  getConfidenceTier,
  HOLD_FRAMES,
  HIDE_N_FRAMES,
  MAX_PX_PER_FRAME,
  SHOW_N_FRAMES,
  TRACKING_QUALITY_CONFIG,
} from './config';
import type { TrackingPipelineFlags, TrackingPipelineMode, TrackingQualityPipeline } from './types';

function parseBooleanFlag(value: string | undefined): boolean | null {
  if (value === undefined) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }

  return null;
}

function getDefaultUseNewTrackingPipeline(): boolean {
  if (process.env.NODE_ENV === 'test') {
    return true;
  }

  if (typeof __DEV__ === 'boolean') {
    return __DEV__;
  }

  return false;
}

export function readUseNewTrackingPipelineFlag(): boolean {
  const explicitValue =
    process.env.EXPO_PUBLIC_USE_NEW_TRACKING_PIPELINE ?? process.env.USE_NEW_TRACKING_PIPELINE;
  const parsed = parseBooleanFlag(explicitValue);
  if (parsed !== null) {
    return parsed;
  }

  return getDefaultUseNewTrackingPipeline();
}

export function resolveTrackingPipelineMode(): TrackingPipelineMode {
  return readUseNewTrackingPipelineFlag() ? 'new' : 'legacy';
}

export function getTrackingPipelineFlags(): TrackingPipelineFlags {
  const useNewTrackingPipeline = readUseNewTrackingPipelineFlag();
  return {
    useNewTrackingPipeline,
    mode: useNewTrackingPipeline ? 'new' : 'legacy',
  };
}

export function createTrackingQualityPipelineState(): RealtimeFormEngineState {
  return createRealtimeFormEngineState();
}

export function processTrackingQualityAngles(input: {
  state: RealtimeFormEngineState;
  angles: Parameters<typeof processRealtimeAngles>[0]['angles'];
  valid: Parameters<typeof processRealtimeAngles>[0]['valid'];
  timestampSec: number;
  shadowMeanAbsDelta?: number | null;
}): RealtimeFormEngineOutput {
  return processRealtimeAngles(input);
}

export function getTrackingQualityPipeline(mode = resolveTrackingPipelineMode()): TrackingQualityPipeline {
  return {
    mode,
    createState: createTrackingQualityPipelineState,
    processAngles: processTrackingQualityAngles,
  };
}

export {
  CONFIDENCE_TIER_THRESHOLDS,
  EMA_ALPHA_ANGLE,
  EMA_ALPHA_COORD,
  getConfidenceTier,
  HOLD_FRAMES,
  HIDE_N_FRAMES,
  MAX_PX_PER_FRAME,
  SHOW_N_FRAMES,
  TRACKING_QUALITY_CONFIG,
};

export { clampVelocity, filterCoordinates, smoothAngleEMA, smoothCoordinateEMA } from './filters';

export type {
  TrackingConfidenceThresholds,
  TrackingConfidenceTier,
  TrackingPipelineFlags,
  TrackingPipelineMode,
  TrackingQualityConfig,
  TrackingQualityPipeline,
} from './types';
