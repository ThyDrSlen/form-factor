/**
 * Rest Timer Service
 *
 * Computes default rest durations, schedules local notifications,
 * and handles background resume for workout rest periods.
 */

import * as Notifications from 'expo-notifications';
import { GoalProfile, SetType } from '@/lib/types/workout-session';
import { logWithTs, warnWithTs } from '@/lib/logger';

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

/**
 * Schedule a local notification for when rest is complete.
 */
export async function scheduleRestNotification(
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
