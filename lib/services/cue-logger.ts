/**
 * Cue Logger Service
 * 
 * Logs cue events and session metrics with versioning,
 * experiment tracking, and environment context.
 */

import * as Crypto from 'expo-crypto';
import { supabase } from '@/lib/supabase';
import { getTelemetryContext, getEnvironmentContext, getSessionQuality, getRetentionClass } from './telemetry-context';
import type { SessionMetricsPayload } from '@/lib/types/telemetry';

// =============================================================================
// Types
// =============================================================================

type CueEventPayload = {
  sessionId: string;
  cue: string;
  mode?: string;
  phase?: string;
  repCount?: number;
  reason?: string;
  throttled?: boolean;
  dropped?: boolean;
  latencyMs?: number;
};

// Re-export SessionMetricsPayload for backward compatibility
export type { SessionMetricsPayload };

// =============================================================================
// Helpers
// =============================================================================

async function ensureUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user?.id) throw new Error('Not signed in');
  return data.user.id;
}

/**
 * Generate a unique session ID
 */
export function generateSessionId(): string {
  return Crypto.randomUUID();
}

// =============================================================================
// Cue Event Logging
// =============================================================================

/**
 * Log a cue event with experiment tracking
 */
export async function logCueEvent(event: CueEventPayload): Promise<void> {
  try {
    const userId = await ensureUserId();
    const context = getTelemetryContext();

    await supabase.from('cue_events').insert({
      user_id: userId,
      session_id: event.sessionId,
      cue: event.cue,
      mode: event.mode,
      phase: event.phase,
      rep_count: event.repCount,
      reason: event.reason,
      throttled: event.throttled ?? false,
      dropped: event.dropped ?? false,
      latency_ms: event.latencyMs,
      // Experiment tracking
      experiment_id: context.experimentId ?? null,
      variant: context.variant ?? null,
      cue_config_version: context.cueConfigVersion,
    });
  } catch (error) {
    if (__DEV__) {
      console.warn('[cue-logger] failed to log cue event', error, event);
    }
  }
}

// =============================================================================
// Session Metrics
// =============================================================================

/**
 * Upsert session metrics with full context
 * 
 * Can be called multiple times per session - uses upsert to update.
 * Automatically includes versioning, environment, and quality context.
 */
export async function upsertSessionMetrics(metrics: SessionMetricsPayload): Promise<void> {
  try {
    const userId = await ensureUserId();
    const telemetry = getTelemetryContext();
    const environment = getEnvironmentContext();
    const quality = getSessionQuality();
    const retentionClass = getRetentionClass();

    const payload: Record<string, unknown> = {
      user_id: userId,
      session_id: metrics.sessionId,
      
      // Timestamps
      start_at: metrics.startAt,
      end_at: metrics.endAt,
      
      // Performance metrics
      avg_fps: metrics.avgFps,
      min_fps: metrics.minFps,
      avg_latency_ms: metrics.avgLatencyMs,
      
      // Cue statistics
      cues_total: metrics.cuesTotal,
      cues_spoken: metrics.cuesSpoken,
      cues_dropped_repeat: metrics.cuesDroppedRepeat,
      cues_dropped_disabled: metrics.cuesDroppedDisabled,
      
      // Versioning (from context or explicit)
      model_version: metrics.modelVersion ?? telemetry.modelVersion,
      cue_config_version: metrics.cueConfigVersion ?? telemetry.cueConfigVersion,
      exercise_config_version: metrics.exerciseConfigVersion ?? telemetry.exerciseConfigVersion,
      
      // Experiment tracking (from context or explicit)
      experiment_id: metrics.experimentId ?? telemetry.experimentId ?? null,
      variant: metrics.variant ?? telemetry.variant ?? null,
      
      // Environment (from context or explicit)
      device_model: metrics.deviceModel ?? environment?.deviceModel ?? null,
      os_version: metrics.osVersion ?? environment?.osVersion ?? null,
      camera_angle_class: metrics.cameraAngleClass ?? environment?.cameraAngleClass ?? null,
      distance_bucket: metrics.distanceBucket ?? environment?.distanceBucket ?? null,
      lighting_bucket: metrics.lightingBucket ?? environment?.lightingBucket ?? null,
      mirror_present: metrics.mirrorPresent ?? environment?.mirrorPresent ?? null,
      
      // Quality signals (from context or explicit)
      pose_lost_count: metrics.poseLostCount ?? quality.poseLostCount,
      low_confidence_frames: metrics.lowConfidenceFrames ?? quality.lowConfidenceFrames,
      tracking_reset_count: metrics.trackingResetCount ?? quality.trackingResetCount,
      user_aborted_early: metrics.userAbortedEarly ?? quality.userAbortedEarly,
      cues_disabled_mid_session: metrics.cuesDisabledMidSession ?? quality.cuesDisabledMidSession,
      
      // Retention
      retention_class: metrics.retentionClass ?? retentionClass,
    };

    await supabase.from('session_metrics').upsert(payload, { onConflict: 'session_id' });
  } catch (error) {
    if (__DEV__) {
      console.warn('[cue-logger] failed to upsert session metrics', error, metrics);
    }
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Create a new session and return the session ID
 * Initializes session metrics with start time
 */
export async function startSession(): Promise<string> {
  const sessionId = generateSessionId();
  
  await upsertSessionMetrics({
    sessionId,
    startAt: new Date().toISOString(),
  });

  return sessionId;
}

/**
 * End a session by setting the end time
 */
export async function endSession(
  sessionId: string,
  finalMetrics?: Partial<SessionMetricsPayload>
): Promise<void> {
  await upsertSessionMetrics({
    sessionId,
    endAt: new Date().toISOString(),
    ...finalMetrics,
  });
}
