/**
 * Drill Tracker Service
 *
 * Logs drill adoption events via the existing cue telemetry channel so
 * we can measure which corrective drills actually get opened + started
 * in the field. Intentionally piggybacks on `cue_events` — no new
 * Supabase table / migration required.
 *
 * Events use the `cue` field to encode the drill and `reason` to
 * encode the action (viewed/started/completed/dismissed).
 */
import { logCueEvent } from '@/lib/services/cue-logger';
import { warnWithTs } from '@/lib/logger';

export type DrillAction = 'viewed' | 'started' | 'completed' | 'dismissed';

interface DrillEventInput {
  sessionId: string;
  /** Exercise id the drill is attached to (e.g., 'pullup') */
  exerciseId: string;
  /** The fault that surfaced the drill (e.g., 'shoulder_elevation') */
  faultId: string;
  /** Drill identifier from FaultDefinition.drills[].id */
  drillId: string;
  /** Lifecycle action */
  action: DrillAction;
  /** Optional rep number when the drill was offered */
  repCount?: number;
}

/**
 * Fire-and-forget drill adoption log. Silently swallows errors so the
 * UI never blocks on telemetry failures.
 */
export async function logDrillEvent(input: DrillEventInput): Promise<void> {
  try {
    await logCueEvent({
      sessionId: input.sessionId,
      cue: `drill:${input.drillId}`,
      mode: input.exerciseId,
      phase: input.faultId,
      reason: `drill_${input.action}`,
      repCount: input.repCount,
    });
  } catch (err) {
    if (__DEV__) warnWithTs('[drill-tracker] failed to log drill event', err, input);
  }
}

/** Shorthand for the most common calls. */
export const drillTracker = {
  markViewed: (args: Omit<DrillEventInput, 'action'>) => logDrillEvent({ ...args, action: 'viewed' }),
  markStarted: (args: Omit<DrillEventInput, 'action'>) => logDrillEvent({ ...args, action: 'started' }),
  markCompleted: (args: Omit<DrillEventInput, 'action'>) => logDrillEvent({ ...args, action: 'completed' }),
  markDismissed: (args: Omit<DrillEventInput, 'action'>) => logDrillEvent({ ...args, action: 'dismissed' }),
};
