/**
 * Pose Logger Service
 * 
 * Buffers and batches pose sample uploads to Supabase.
 * Includes versioning, confidence, and environment context.
 */

import { supabase } from '@/lib/supabase';
import { ensureUserId } from '@/lib/auth-utils';
import { getTelemetryContext, incrementLowConfidenceFrame } from './telemetry-context';
import { shouldLogFramesSync } from './consent-service';
import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';

// =============================================================================
// Types
// =============================================================================

export interface PoseSample {
  sessionId: string;
  frameTimestamp: number;
  exerciseMode: 'pullup' | 'pushup' | string;
  phase: string;
  repNumber: number | null;
  angles: JointAngles;
  positions?: Record<string, { x: number; y: number; z: number }>;
  fpsAtCapture?: number;
  // New fields for ML evaluation
  frameIdx?: number;
  poseConfidence?: number[];
  inferenceMs?: number;
  lightingScore?: number;
  cameraPose?: [number, number, number, number, number, number];
}

interface QueuedPoseSample extends PoseSample {
  userId: string;
  modelVersion: string;
  cueConfigVersion: string;
}

// =============================================================================
// Configuration
// =============================================================================

const BUFFER_SIZE = 100; // Max samples before forcing flush
const FLUSH_INTERVAL_MS = 3000; // Flush every 3 seconds
const SAMPLE_RATE_HZ = 12; // Sample at 12 Hz (every ~2.5 frames at 30fps)
const LOW_CONFIDENCE_THRESHOLD = 0.5; // Threshold for counting low confidence frames

// =============================================================================
// Internal State
// =============================================================================

let buffer: QueuedPoseSample[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let lastSampleTime = 0;
let isFlushing = false;
let frameCounter = 0;

/**
 * Check if confidence is below threshold
 */
function hasLowConfidence(confidence?: number[]): boolean {
  if (!confidence || confidence.length === 0) return false;
  const avgConfidence = confidence.reduce((a, b) => a + b, 0) / confidence.length;
  return avgConfidence < LOW_CONFIDENCE_THRESHOLD;
}

// =============================================================================
// Buffer Management
// =============================================================================

/**
 * Flush buffered pose samples to Supabase
 */
async function flushBuffer(): Promise<void> {
  if (isFlushing || buffer.length === 0) {
    return;
  }

  isFlushing = true;
  const samplesToFlush = [...buffer];
  buffer = [];

  try {
    const { error } = await supabase.from('pose_samples').insert(
      samplesToFlush.map((sample) => ({
        user_id: sample.userId,
        session_id: sample.sessionId,
        frame_timestamp: sample.frameTimestamp,
        exercise_mode: sample.exerciseMode,
        phase: sample.phase,
        rep_number: sample.repNumber ?? null,
        // Joint angles
        left_elbow_deg: sample.angles.leftElbow,
        right_elbow_deg: sample.angles.rightElbow,
        left_shoulder_deg: sample.angles.leftShoulder,
        right_shoulder_deg: sample.angles.rightShoulder,
        left_knee_deg: sample.angles.leftKnee,
        right_knee_deg: sample.angles.rightKnee,
        left_hip_deg: sample.angles.leftHip,
        right_hip_deg: sample.angles.rightHip,
        // Extended fields
        joint_positions: sample.positions || null,
        fps_at_capture: sample.fpsAtCapture ?? null,
        frame_idx: sample.frameIdx ?? null,
        pose_confidence: sample.poseConfidence ?? null,
        inference_ms: sample.inferenceMs ?? null,
        lighting_score: sample.lightingScore ?? null,
        camera_pose: sample.cameraPose ?? null,
        // Versioning
        model_version: sample.modelVersion,
        cue_config_version: sample.cueConfigVersion,
      }))
    );

    if (error) {
      throw error;
    }

    if (__DEV__) {
      console.log(`[pose-logger] Flushed ${samplesToFlush.length} pose samples to Supabase`);
    }
  } catch (error) {
    // Re-add samples to buffer on error (they'll be retried on next flush)
    buffer.unshift(...samplesToFlush);
    if (__DEV__) {
      console.warn('[pose-logger] Failed to flush pose samples', error);
    }
  } finally {
    isFlushing = false;
  }
}

/**
 * Schedule automatic buffer flush
 */
function scheduleFlush(): void {
  if (flushTimer) {
    return; // Already scheduled
  }

  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushBuffer().catch((error) => {
      if (__DEV__) {
        console.error('[pose-logger] Error in scheduled flush', error);
      }
    });
  }, FLUSH_INTERVAL_MS);
}

/**
 * Check if we should sample this frame based on rate limiting
 */
function shouldSample(): boolean {
  const now = Date.now();
  const minInterval = 1000 / SAMPLE_RATE_HZ;

  if (now - lastSampleTime >= minInterval) {
    lastSampleTime = now;
    return true;
  }
  return false;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Log a pose sample to the buffer
 * Samples are automatically batched and uploaded to Supabase
 * 
 * Respects user consent settings and rate limiting.
 */
export async function logPoseSample(sample: PoseSample): Promise<void> {
  // Check consent (sync check to avoid blocking)
  if (!shouldLogFramesSync()) {
    return;
  }

  // Rate limit sampling
  if (!shouldSample()) {
    return;
  }

  // Track low confidence frames
  if (hasLowConfidence(sample.poseConfidence)) {
    incrementLowConfidenceFrame();
  }

  try {
    const userId = await ensureUserId();
    const context = getTelemetryContext();

    frameCounter += 1;

    const queuedSample: QueuedPoseSample = {
      ...sample,
      userId,
      frameIdx: sample.frameIdx ?? frameCounter,
      modelVersion: context.modelVersion,
      cueConfigVersion: context.cueConfigVersion,
    };

    buffer.push(queuedSample);

    // Flush if buffer is full
    if (buffer.length >= BUFFER_SIZE) {
      await flushBuffer();
    } else {
      // Schedule automatic flush
      scheduleFlush();
    }
  } catch (error) {
    if (__DEV__) {
      console.warn('[pose-logger] Failed to queue pose sample', error, sample);
    }
  }
}

/**
 * Flush all remaining pose samples in the buffer
 * Call this when a session ends to ensure all data is saved
 */
export async function flushPoseBuffer(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  await flushBuffer();
}

/**
 * Clear the pose buffer without flushing
 * Useful for resetting state between sessions
 */
export function clearPoseBuffer(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  buffer = [];
  lastSampleTime = 0;
  frameCounter = 0;
}

/**
 * Get current buffer size (for debugging/monitoring)
 */
export function getBufferSize(): number {
  return buffer.length;
}

/**
 * Get current frame counter
 */
export function getFrameCounter(): number {
  return frameCounter;
}

/**
 * Reset frame counter (call at session start)
 */
export function resetFrameCounter(): void {
  frameCounter = 0;
}
