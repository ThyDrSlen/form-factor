/**
 * Telemetry Context Singleton
 * 
 * Manages global versioning and experiment context that gets attached
 * to all telemetry events. Initialize once at app startup.
 */

import { Platform } from 'react-native';
import * as Device from 'expo-device';
import type { TelemetryContext, EnvironmentContext, SessionQuality, RetentionClass } from '@/lib/types/telemetry';

// =============================================================================
// Version Constants
// =============================================================================

/** Current pose model version - update when changing angle calculation logic */
export const MODEL_VERSION = 'arkit-angles@1.0.0';

/** Current cue config version - update when changing thresholds/debounce */
export const CUE_CONFIG_VERSION = 'v1';

/** Current exercise config version - update when changing per-exercise targets */
export const EXERCISE_CONFIG_VERSION = 'v1';

// =============================================================================
// Global Context State
// =============================================================================

let telemetryContext: TelemetryContext = {
  modelVersion: MODEL_VERSION,
  cueConfigVersion: CUE_CONFIG_VERSION,
  exerciseConfigVersion: EXERCISE_CONFIG_VERSION,
};

let environmentContext: EnvironmentContext | null = null;

let sessionQuality: SessionQuality = {
  poseLostCount: 0,
  lowConfidenceFrames: 0,
  trackingResetCount: 0,
  userAbortedEarly: false,
  cuesDisabledMidSession: false,
};

let retentionClass: RetentionClass = 'short';

// =============================================================================
// Telemetry Context
// =============================================================================

/**
 * Get the current telemetry context
 */
export function getTelemetryContext(): TelemetryContext {
  return { ...telemetryContext };
}

/**
 * Update telemetry context (partial update)
 */
export function setTelemetryContext(ctx: Partial<TelemetryContext>): void {
  telemetryContext = { ...telemetryContext, ...ctx };
}

/**
 * Set the current experiment
 */
export function setExperiment(experimentId: string, variant: string): void {
  telemetryContext = {
    ...telemetryContext,
    experimentId,
    variant,
  };
}

/**
 * Clear experiment (e.g., when user opts out)
 */
export function clearExperiment(): void {
  const { experimentId: _, variant: __, ...rest } = telemetryContext;
  telemetryContext = rest as TelemetryContext;
}

// =============================================================================
// Environment Context
// =============================================================================

/**
 * Initialize environment context (call once per session)
 */
export async function initEnvironmentContext(): Promise<EnvironmentContext> {
  const deviceModel = Device.modelId ?? Device.modelName ?? 'unknown';
  const osVersion = `${Platform.OS} ${Platform.Version}`;

  environmentContext = {
    deviceModel,
    osVersion,
  };

  return environmentContext;
}

/**
 * Get the current environment context
 */
export function getEnvironmentContext(): EnvironmentContext | null {
  return environmentContext ? { ...environmentContext } : null;
}

/**
 * Update environment context (e.g., when camera setup changes)
 */
export function setEnvironmentContext(ctx: Partial<EnvironmentContext>): void {
  if (environmentContext) {
    environmentContext = { ...environmentContext, ...ctx };
  } else {
    environmentContext = {
      deviceModel: 'unknown',
      osVersion: 'unknown',
      ...ctx,
    };
  }
}

/**
 * Set camera angle classification
 */
export function setCameraAngle(angle: 'side' | 'front' | 'rear_three_quarter'): void {
  setEnvironmentContext({ cameraAngleClass: angle });
}

/**
 * Set distance bucket
 */
export function setDistanceBucket(bucket: 'close' | 'medium' | 'far'): void {
  setEnvironmentContext({ distanceBucket: bucket });
}

/**
 * Set lighting bucket
 */
export function setLightingBucket(bucket: 'low' | 'medium' | 'good'): void {
  setEnvironmentContext({ lightingBucket: bucket });
}

// =============================================================================
// Session Quality
// =============================================================================

/**
 * Get current session quality metrics
 */
export function getSessionQuality(): SessionQuality {
  return { ...sessionQuality };
}

/**
 * Reset session quality (call at session start)
 */
export function resetSessionQuality(): void {
  sessionQuality = {
    poseLostCount: 0,
    lowConfidenceFrames: 0,
    trackingResetCount: 0,
    userAbortedEarly: false,
    cuesDisabledMidSession: false,
  };
}

/**
 * Increment pose lost count
 */
export function incrementPoseLost(): void {
  sessionQuality.poseLostCount += 1;
}

/**
 * Increment low confidence frame count
 */
export function incrementLowConfidenceFrame(): void {
  sessionQuality.lowConfidenceFrames += 1;
}

/**
 * Increment tracking reset count
 */
export function incrementTrackingReset(): void {
  sessionQuality.trackingResetCount += 1;
}

/**
 * Mark session as aborted early
 */
export function markAbortedEarly(): void {
  sessionQuality.userAbortedEarly = true;
}

/**
 * Mark that cues were disabled mid-session
 */
export function markCuesDisabled(): void {
  sessionQuality.cuesDisabledMidSession = true;
}

// =============================================================================
// Retention
// =============================================================================

/**
 * Get current retention class
 */
export function getRetentionClass(): RetentionClass {
  return retentionClass;
}

/**
 * Set retention class (e.g., when user joins a study)
 */
export function setRetentionClass(cls: RetentionClass): void {
  retentionClass = cls;
}

// =============================================================================
// Combined Context for Logging
// =============================================================================

/**
 * Get all context needed for session metrics
 */
export function getFullSessionContext(): {
  telemetry: TelemetryContext;
  environment: EnvironmentContext | null;
  quality: SessionQuality;
  retentionClass: RetentionClass;
} {
  return {
    telemetry: getTelemetryContext(),
    environment: getEnvironmentContext(),
    quality: getSessionQuality(),
    retentionClass: getRetentionClass(),
  };
}

/**
 * Initialize all context at session start
 */
export async function initSessionContext(): Promise<void> {
  await initEnvironmentContext();
  resetSessionQuality();
}
