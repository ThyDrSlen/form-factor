/**
 * Rest Timer Service
 *
 * Computes default rest durations, schedules local notifications,
 * and handles background resume for workout rest periods.
 */

import * as Notifications from 'expo-notifications';
import { GoalProfile, SetType } from '@/lib/types/workout-session';
import { logWithTs, warnWithTs } from '@/lib/logger';
import { hapticBus } from '@/lib/haptics/haptic-bus';

// =============================================================================
// Rest Duration Defaults
// =============================================================================

interface RestDurationParams {
  goalProfile: GoalProfile;
  isCompound: boolean;
  setType: SetType;
  perceivedRpe?: number | null;
  overrideSeconds?: number | null;
}

/**
 * Compute the default rest duration in seconds.
 *
 * Priority:
 * 1. Explicit override (per-set or per-exercise)
 * 2. Set type modifier
 * 3. Goal profile + compound/isolation base
 */
export function computeRestSeconds(params: RestDurationParams): number {
  const { goalProfile, isCompound, setType, perceivedRpe, overrideSeconds } = params;

  // 1. Explicit override wins
  if (overrideSeconds != null && overrideSeconds > 0) {
    return overrideSeconds;
  }

  // 2. Set type special cases
  if (setType === 'warmup') return 60;
  if (setType === 'dropset') return 15;

  // 3. Base rest by goal + exercise type
  let base: number;
  switch (goalProfile) {
    case 'strength':
      base = isCompound ? 210 : 150; // 3:30 or 2:30
      break;
    case 'power':
      base = isCompound ? 240 : 180; // 4:00 or 3:00
      break;
    case 'hypertrophy':
      base = isCompound ? 120 : 90; // 2:00 or 1:30
      break;
    case 'endurance':
      base = isCompound ? 60 : 45;
      break;
    case 'mixed':
    default:
      base = isCompound ? 120 : 90;
      break;
  }

  // 4. RPE modifier: high RPE gets a little extra rest
  if (perceivedRpe != null && perceivedRpe >= 9) {
    base = Math.round(base * 1.2);
  } else if (perceivedRpe != null && perceivedRpe >= 8) {
    base = Math.round(base * 1.1);
  }

  // 5. AMRAP/failure get extra rest
  if (setType === 'amrap' || setType === 'failure') {
    base = Math.round(base * 1.3);
  }

  return base;
}

// =============================================================================
// Timer Computation
// =============================================================================

/**
 * Compute remaining rest time in seconds.
 * Returns 0 if rest is already complete.
 */
export function computeRemainingSeconds(
  restStartedAt: string | Date,
  restTargetSeconds: number,
): number {
  const startMs = typeof restStartedAt === 'string'
    ? new Date(restStartedAt).getTime()
    : restStartedAt.getTime();
  const elapsed = (Date.now() - startMs) / 1000;
  return Math.max(0, Math.round(restTargetSeconds - elapsed));
}

/**
 * Check if rest period is complete.
 */
export function isRestComplete(
  restStartedAt: string | Date,
  restTargetSeconds: number,
): boolean {
  return computeRemainingSeconds(restStartedAt, restTargetSeconds) <= 0;
}

// =============================================================================
// Local Notifications
// =============================================================================

let activeRestNotificationId: string | null = null;
let pendingSchedule: Promise<string | null> | null = null;

/**
 * Schedule a local notification for when rest is complete.
 *
 * Serialised via `pendingSchedule` so that two rapid calls cannot
 * interleave — the second call waits for the first to finish (and
 * store its ID) before cancelling it.
 */
export async function scheduleRestNotification(
  targetSeconds: number,
  exerciseName?: string,
  nextSetNumber?: number,
): Promise<string | null> {
  // Wait for any in-flight schedule to finish so its ID is stored
  // before we try to cancel it.
  if (pendingSchedule) {
    await pendingSchedule.catch(() => {});
  }

  const task = _scheduleRestNotification(targetSeconds, exerciseName, nextSetNumber);
  pendingSchedule = task;

  try {
    return await task;
  } finally {
    if (pendingSchedule === task) pendingSchedule = null;
  }
}

async function _scheduleRestNotification(
  targetSeconds: number,
  exerciseName?: string,
  nextSetNumber?: number,
): Promise<string | null> {
  try {
    // Cancel any existing rest notification
    await cancelRestNotification();

    const body = nextSetNumber && exerciseName
      ? `Time for set ${nextSetNumber} of ${exerciseName}`
      : 'Your rest period is over. Time for the next set!';

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Rest Complete',
        body,
        sound: 'default',
        categoryIdentifier: 'rest_timer',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: targetSeconds,
        repeats: false,
      },
    });

    activeRestNotificationId = id;
    logWithTs(`[RestTimer] Scheduled notification in ${targetSeconds}s (id: ${id})`);
    return id;
  } catch (error) {
    warnWithTs('[RestTimer] Failed to schedule notification:', error);
    return null;
  }
}

/**
 * Cancel the active rest notification (on skip or early dismiss).
 */
export async function cancelRestNotification(): Promise<void> {
  if (activeRestNotificationId) {
    try {
      await Notifications.cancelScheduledNotificationAsync(activeRestNotificationId);
      logWithTs(`[RestTimer] Cancelled notification (id: ${activeRestNotificationId})`);
    } catch (error) {
      warnWithTs('[RestTimer] Failed to cancel notification:', error);
    }
    activeRestNotificationId = null;
  }
}

/**
 * Format seconds into MM:SS display string.
 */
export function formatRestTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// =============================================================================
// Foreground rest haptic companion
// =============================================================================

let foregroundInterval: ReturnType<typeof setInterval> | null = null;
let lastTick10s = -1;

/**
 * Start a foreground polling companion that emits haptic-bus events while
 * the app is in the foreground. Schedules a `rest.tick10s` event at the
 * 30s/20s/10s marks and `rest.done` when the timer hits zero.
 *
 * Returns a `stop()` function. The local-notification flow still runs for
 * the background case; this companion is purely additive for users who
 * leave the app open during rest.
 */
export function startForegroundRestHapticCompanion(
  restStartedAt: string | Date,
  restTargetSeconds: number,
): () => void {
  stopForegroundRestHapticCompanion();
  lastTick10s = -1;
  let doneEmitted = false;

  const tick = () => {
    const remaining = computeRemainingSeconds(restStartedAt, restTargetSeconds);
    if (remaining <= 0 && !doneEmitted) {
      doneEmitted = true;
      hapticBus.emit('rest.done');
      stopForegroundRestHapticCompanion();
      return;
    }
    // Every full 10-second threshold crossing under 30s.
    if (remaining > 0 && remaining <= 30) {
      const bucket = Math.floor(remaining / 10);
      if (bucket !== lastTick10s) {
        lastTick10s = bucket;
        hapticBus.emit('rest.tick10s');
      }
    }
  };

  tick();
  foregroundInterval = setInterval(tick, 1000);
  return stopForegroundRestHapticCompanion;
}

export function stopForegroundRestHapticCompanion(): void {
  if (foregroundInterval !== null) {
    clearInterval(foregroundInterval);
    foregroundInterval = null;
  }
}
