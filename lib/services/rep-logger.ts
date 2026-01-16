/**
 * Rep Logger Service
 * 
 * Logs rep-level and set-level events for ML evaluation.
 * Includes support for ground truth labeling.
 */

import * as Crypto from 'expo-crypto';
import { supabase } from '@/lib/supabase';
import { ensureUserId } from '@/lib/auth-utils';
import { errorWithTs, logWithTs } from '@/lib/logger';
import { getTelemetryContext } from './telemetry-context';
import type { RepEvent, SetSummary, RepLabel, EmittedCue, RepFeatures } from '@/lib/types/telemetry';

/**
 * Generate a UUID for rep/set IDs
 */
export function generateId(): string {
  return Crypto.randomUUID();
}

// =============================================================================
// Rep Logging
// =============================================================================

/**
 * Log a completed rep with features and fault detection
 * Returns the generated rep_id for reference
 */
export async function logRep(rep: RepEvent): Promise<string> {
  try {
    const userId = await ensureUserId();
    const context = getTelemetryContext();
    const repId = generateId();

    const { error } = await supabase.from('reps').insert({
      rep_id: repId,
      user_id: userId,
      session_id: rep.sessionId,
      set_id: rep.setId ?? null,
      rep_index: rep.repIndex,
      exercise: rep.exercise,
      side: rep.side ?? null,
      start_ts: rep.startTs,
      end_ts: rep.endTs,
      features: rep.features,
      fqi: rep.fqi ?? null,
      faults_detected: rep.faultsDetected,
      cues_emitted: rep.cuesEmitted,
      adopted_within_3_reps: rep.adoptedWithin3Reps ?? null,
      // Versioning from context
      model_version: context.modelVersion,
      cue_config_version: context.cueConfigVersion,
      experiment_id: context.experimentId ?? null,
      variant: context.variant ?? null,
    });

    if (error) {
      throw error;
    }

    if (__DEV__) {
      logWithTs(`[rep-logger] Logged rep ${rep.repIndex} for ${rep.exercise}`, { repId, fqi: rep.fqi });
    }

    return repId;
  } catch (error) {
    if (__DEV__) {
      errorWithTs('[rep-logger] Failed to log rep', error, rep);
    }
    throw error;
  }
}

// =============================================================================
// Set Logging
// =============================================================================

/**
 * Log a completed set with aggregates
 * Returns the generated set_id for reference
 */
export async function logSet(set: SetSummary): Promise<string> {
  try {
    const userId = await ensureUserId();
    const setId = generateId();

    const { error } = await supabase.from('sets').insert({
      set_id: setId,
      user_id: userId,
      session_id: set.sessionId,
      exercise: set.exercise,
      load_value: set.loadValue ?? null,
      load_unit: set.loadUnit ?? null,
      tempo: set.tempo ?? null,
      stance_width: set.stanceWidth ?? null,
      reps_count: set.repsCount,
      avg_fqi: set.avgFqi ?? null,
      faults_histogram: set.faultsHistogram ?? null,
      cues_per_min: set.cuesPerMin ?? null,
      media_uri: set.mediaUri ?? null,
      media_sha256: set.mediaSha256 ?? null,
    });

    if (error) {
      throw error;
    }

    if (__DEV__) {
      logWithTs(`[rep-logger] Logged set for ${set.exercise}`, { setId, reps: set.repsCount });
    }

    return setId;
  } catch (error) {
    if (__DEV__) {
      errorWithTs('[rep-logger] Failed to log set', error, set);
    }
    throw error;
  }
}

/**
 * Update set with media reference after video upload
 */
export async function updateSetMedia(setId: string, mediaUri: string, mediaSha256: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('sets')
      .update({
        media_uri: mediaUri,
        media_sha256: mediaSha256,
      })
      .eq('set_id', setId);

    if (error) {
      throw error;
    }

    if (__DEV__) {
      logWithTs(`[rep-logger] Updated set ${setId} with media`, { mediaUri });
    }
  } catch (error) {
    if (__DEV__) {
      errorWithTs('[rep-logger] Failed to update set media', error);
    }
    throw error;
  }
}

/**
 * Link reps to a set (batch update)
 */
export async function linkRepsToSet(repIds: string[], setId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('reps')
      .update({ set_id: setId })
      .in('rep_id', repIds);

    if (error) {
      throw error;
    }

    if (__DEV__) {
      logWithTs(`[rep-logger] Linked ${repIds.length} reps to set ${setId}`);
    }
  } catch (error) {
    if (__DEV__) {
      errorWithTs('[rep-logger] Failed to link reps to set', error);
    }
    throw error;
  }
}

// =============================================================================
// Label Logging (Ground Truth)
// =============================================================================

/**
 * Add a ground truth label to a rep
 * Used by trainers, users (self-labeling), or automated systems
 */
export async function labelRep(label: RepLabel): Promise<string> {
  try {
    const userId = await ensureUserId();
    const labelId = generateId();

    const { error } = await supabase.from('rep_labels').insert({
      label_id: labelId,
      rep_id: label.repId,
      label_good_form: label.labelGoodForm,
      label_fault_types: label.labelFaultTypes,
      label_source: label.labelSource,
      labeler_id: userId,
      notes: label.notes ?? null,
    });

    if (error) {
      throw error;
    }

    if (__DEV__) {
      logWithTs(`[rep-logger] Added label to rep ${label.repId}`, { labelId, source: label.labelSource });
    }

    return labelId;
  } catch (error) {
    if (__DEV__) {
      errorWithTs('[rep-logger] Failed to label rep', error, label);
    }
    throw error;
  }
}

// =============================================================================
// Aggregation Helpers
// =============================================================================

/**
 * Calculate average FQI from rep data
 */
export function calculateAvgFqi(reps: { fqi?: number }[]): number | undefined {
  const fqis = reps.map(r => r.fqi).filter((f): f is number => f !== undefined);
  if (fqis.length === 0) return undefined;
  return Math.round(fqis.reduce((a, b) => a + b, 0) / fqis.length);
}

/**
 * Build fault histogram from rep data
 */
export function buildFaultHistogram(reps: { faultsDetected: string[] }[]): Record<string, number> {
  const histogram: Record<string, number> = {};
  for (const rep of reps) {
    for (const fault of rep.faultsDetected) {
      histogram[fault] = (histogram[fault] ?? 0) + 1;
    }
  }
  return histogram;
}

/**
 * Calculate cues per minute from rep data
 */
export function calculateCuesPerMin(
  reps: { cuesEmitted: EmittedCue[]; startTs: string; endTs: string }[]
): number | undefined {
  if (reps.length === 0) return undefined;

  const totalCues = reps.reduce((sum, r) => sum + r.cuesEmitted.length, 0);
  const firstStart = new Date(reps[0].startTs).getTime();
  const lastEnd = new Date(reps[reps.length - 1].endTs).getTime();
  const durationMin = (lastEnd - firstStart) / 60000;

  if (durationMin <= 0) return undefined;
  return Math.round((totalCues / durationMin) * 10) / 10;
}

/**
 * Check if a cue was adopted within N reps
 * Looks for fault presence before cue and absence after
 */
export function checkCueAdoption(
  reps: { faultsDetected: string[]; cuesEmitted: EmittedCue[] }[],
  windowSize = 3
): boolean {
  // Simple heuristic: if cues were emitted and faults decreased, consider it adopted
  for (let i = 0; i < reps.length - windowSize; i++) {
    const cuesAtRep = reps[i].cuesEmitted;
    if (cuesAtRep.length === 0) continue;

    const cueTypes = new Set(cuesAtRep.map(c => c.type));
    const faultsBefore = reps[i].faultsDetected.filter(f => cueTypes.has(f)).length;

    // Check if faults decreased in the next N reps
    let faultsAfter = 0;
    for (let j = i + 1; j <= i + windowSize && j < reps.length; j++) {
      faultsAfter += reps[j].faultsDetected.filter(f => cueTypes.has(f)).length;
    }

    if (faultsBefore > 0 && faultsAfter < faultsBefore * windowSize) {
      return true;
    }
  }

  return false;
}

// =============================================================================
// Rep Builder Helper
// =============================================================================

/**
 * Helper class to build a RepEvent during tracking
 */
export class RepBuilder {
  private sessionId: string;
  private exercise: string;
  private setId?: string;
  private repIndex: number;
  private side?: 'left' | 'right';
  private startTs: string;
  private cuesEmitted: EmittedCue[] = [];
  private features: RepFeatures = {};
  private faultsDetected: string[] = [];

  constructor(sessionId: string, exercise: string, repIndex: number) {
    this.sessionId = sessionId;
    this.exercise = exercise;
    this.repIndex = repIndex;
    this.startTs = new Date().toISOString();
  }

  setSetId(setId: string): this {
    this.setId = setId;
    return this;
  }

  setSide(side: 'left' | 'right'): this {
    this.side = side;
    return this;
  }

  addCue(type: string): this {
    this.cuesEmitted.push({ type, ts: new Date().toISOString() });
    return this;
  }

  addFault(fault: string): this {
    if (!this.faultsDetected.includes(fault)) {
      this.faultsDetected.push(fault);
    }
    return this;
  }

  setFeature(key: string, value: number): this {
    this.features[key] = value;
    return this;
  }

  setFeatures(features: RepFeatures): this {
    this.features = { ...this.features, ...features };
    return this;
  }

  /**
   * Build the final RepEvent
   * @param fqi Form quality index (0-100)
   */
  build(fqi?: number): RepEvent {
    return {
      sessionId: this.sessionId,
      setId: this.setId,
      repIndex: this.repIndex,
      exercise: this.exercise,
      side: this.side,
      startTs: this.startTs,
      endTs: new Date().toISOString(),
      features: this.features,
      fqi,
      faultsDetected: this.faultsDetected,
      cuesEmitted: this.cuesEmitted,
    };
  }
}
