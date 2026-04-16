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
  N_CONSEC_FRAMES,
  REP_DETECTOR_THRESHOLDS,
  SHOW_N_FRAMES,
  TRACKING_QUALITY_CONFIG,
} from './config';
import {
  HumanValidationGuard,
  type HumanValidationOptions,
} from './human-validation';
import {
  SubjectIdentityTracker,
  type SubjectIdentityOptions,
} from './subject-identity';
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

/**
 * Read the EXPO_PUBLIC_TRACKING_GUARDS feature flag.
 *
 * Opts in to the stress-hardening guards (HumanValidationGuard +
 * SubjectIdentityTracker) described in #451. Default OFF — the guards
 * are defensive and should not be shipped to all users until their
 * thresholds are validated against real ARKit captures via
 * `scripts/eval-guards-from-supabase.ts`.
 *
 * Treats an unset, empty, or explicit '0' / 'false' / 'no' / 'off' value
 * as disabled. Every other non-empty value is treated as enabled.
 */
export function readTrackingGuardsFlag(): boolean {
  const raw = process.env.EXPO_PUBLIC_TRACKING_GUARDS;
  if (raw === undefined) return false;
  const parsed = parseBooleanFlag(raw);
  if (parsed !== null) return parsed;
  // Non-empty, unrecognised values count as enabled (defensive opt-in).
  return raw.trim().length > 0;
}

/**
 * Factory that returns ready-to-use guard instances when the feature flag
 * is enabled, or `null` when disabled so call sites can skip the per-frame
 * work entirely. Safe to call on every pipeline init.
 *
 * TODO(#451): wire these instances directly into the joint-processing
 * path. The current `processTrackingQualityAngles` entry point receives
 * derived angles rather than raw joints, so integration must happen at
 * the ARKit frame boundary (scan-arkit.tsx / use-workout-controller.ts)
 * where the joint map is still available. Until that integration lands,
 * call sites should instantiate via `createTrackingGuards()` themselves.
 */
export function createTrackingGuards(options?: {
  enabled?: boolean;
  human?: HumanValidationOptions;
  subject?: SubjectIdentityOptions;
}): {
  enabled: boolean;
  human: HumanValidationGuard | null;
  subject: SubjectIdentityTracker | null;
} {
  const enabled = options?.enabled ?? readTrackingGuardsFlag();
  if (!enabled) {
    return { enabled: false, human: null, subject: null };
  }

  return {
    enabled: true,
    human: new HumanValidationGuard(options?.human),
    subject: new SubjectIdentityTracker(options?.subject),
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
  N_CONSEC_FRAMES,
  REP_DETECTOR_THRESHOLDS,
  SHOW_N_FRAMES,
  TRACKING_QUALITY_CONFIG,
};

export { clampVelocity, filterCoordinates, smoothAngleEMA, smoothCoordinateEMA } from './filters';

export { HumanValidationGuard } from './human-validation';
export type {
  HumanValidationOptions,
  HumanValidationResult,
  Joint2D as HumanValidationJoint2D,
} from './human-validation';

export { SubjectIdentityTracker } from './subject-identity';
export type {
  SubjectIdentityOptions,
  SubjectIdentitySnapshot,
} from './subject-identity';

export {
  calculateComponentScores,
  calculateOverallScore,
  scorePullupWithComponentAvailability,
} from './scoring';

export type {
  PullupComponentAvailability,
  PullupComponentAvailabilityMap,
  PullupScoreComponents,
  PullupScoringInput,
  PullupScoringResult,
  VisibilityBadge,
} from './scoring';

export type {
  RepDetectorThresholds,
  TrackingConfidenceThresholds,
  TrackingConfidenceTier,
  TrackingPipelineFlags,
  TrackingPipelineMode,
  TrackingQualityConfig,
  TrackingQualityPipeline,
} from './types';
