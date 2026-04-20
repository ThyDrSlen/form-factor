/**
 * Workout Scheduler
 *
 * Binds workout templates to scheduled notifications and produces the
 * deep-link URL the scan tab consumes on open:
 *
 *   form-factor://scan?templateId=<uuid>
 *
 * Responsibilities:
 *   - `scheduleTemplatedWorkout(templateId, scheduledAt)` — defers to the
 *     notifications service's `scheduleTemplatedReminder` (added in the
 *     same PR) so we don't duplicate push-notification plumbing here.
 *   - `getNextScheduledTemplate(userId)` — reads the `scheduled_workouts`
 *     Supabase table (deferred — returns null until schema lands) and
 *     falls back to reading `scheduled_next_dates` from the template row
 *     when present.
 *   - `buildScanDeepLink(templateId)` — deterministic URL builder, safe
 *     for use in tests + notification payloads.
 *
 * Failure modes (all return safe defaults, never throw):
 *   - Notifications disabled / permission denied → log + resolve
 *   - Supabase error → log + null
 *
 * Issue #447 W3-C item #4.
 */

import { supabase } from '@/lib/supabase';
import { errorWithTs, logWithTs } from '@/lib/logger';
import { scheduleTemplatedReminder } from '@/lib/services/notifications';
import type { WorkoutTemplate } from '@/lib/types/workout-session';

// =============================================================================
// Constants
// =============================================================================

/** URL scheme registered in app.config for deep links. */
export const SCAN_DEEP_LINK_SCHEME = 'form-factor';

/** Parse-friendly prefix for the scan deep link. */
export const SCAN_DEEP_LINK_BASE = `${SCAN_DEEP_LINK_SCHEME}://scan`;

// =============================================================================
// Types
// =============================================================================

export interface ScheduledTemplate {
  template: WorkoutTemplate;
  scheduledAt: Date;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Build a deep-link URL the scan tab reads on open.
 * Shape: `form-factor://scan?templateId=<uuid>`.
 */
export function buildScanDeepLink(templateId: string): string {
  const safe = encodeURIComponent(String(templateId));
  return `${SCAN_DEEP_LINK_BASE}?templateId=${safe}`;
}

/**
 * Extract the templateId from a deep-link URL, returning `null` when the
 * URL is malformed, points somewhere else, or carries no templateId query.
 * Works for both expo-router-style relative URLs and full scheme URLs.
 */
export function parseTemplateIdFromUrl(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  try {
    // Accept both full URLs and bare query strings (?templateId=xxx).
    const normalised = url.includes('://') ? url : `${SCAN_DEEP_LINK_BASE}${url.startsWith('?') ? url : ''}`;
    const parsed = new URL(normalised);
    // Only accept scan-route URLs — refuse random host segments.
    if (parsed.host && parsed.host !== 'scan' && !parsed.pathname.endsWith('/scan') && parsed.pathname !== '/scan') {
      // Tolerate `form-factor://scan?...` (URL parses host='scan').
      if (parsed.hostname !== 'scan') return null;
    }
    const tid = parsed.searchParams.get('templateId');
    if (!tid) return null;
    return tid;
  } catch {
    return null;
  }
}

/**
 * Schedule a reminder notification + local DB marker for a template.
 * Delegates the actual notification call to `notifications.scheduleTemplatedReminder`.
 */
export async function scheduleTemplatedWorkout(
  templateId: string,
  scheduledAt: Date,
): Promise<void> {
  if (!templateId || typeof templateId !== 'string') {
    errorWithTs('[workout-scheduler] Missing templateId', { templateId });
    return;
  }
  if (!(scheduledAt instanceof Date) || Number.isNaN(scheduledAt.getTime())) {
    errorWithTs('[workout-scheduler] Invalid scheduledAt', { scheduledAt });
    return;
  }
  if (scheduledAt.getTime() < Date.now()) {
    logWithTs('[workout-scheduler] scheduledAt is in the past; skipping', {
      templateId,
      scheduledAt: scheduledAt.toISOString(),
    });
    return;
  }

  try {
    await scheduleTemplatedReminder(templateId, scheduledAt);
    logWithTs('[workout-scheduler] Scheduled templated reminder', {
      templateId,
      scheduledAt: scheduledAt.toISOString(),
    });
  } catch (err) {
    errorWithTs('[workout-scheduler] Failed to schedule reminder', err);
  }
}

/**
 * Fetch the next scheduled template for a user.
 *
 * Current strategy:
 *   - Query `workout_templates` rows owned by `userId` whose
 *     `scheduled_next_dates` contains a date in the future.
 *   - Return the closest upcoming date + its template.
 *
 * Returns `null` when none found or on error.
 */
export async function getNextScheduledTemplate(
  userId: string,
): Promise<ScheduledTemplate | null> {
  if (!userId || typeof userId !== 'string') return null;

  try {
    const { data, error } = await supabase
      .from('workout_templates')
      .select('*')
      .eq('user_id', userId);

    if (error) {
      errorWithTs('[workout-scheduler] Supabase error fetching templates', {
        code: error.code,
        message: error.message,
      });
      return null;
    }

    if (!data || data.length === 0) return null;

    const now = Date.now();
    let bestTemplate: WorkoutTemplate | null = null;
    let bestTime: number = Number.POSITIVE_INFINITY;

    for (const row of data as Array<WorkoutTemplate & { scheduled_next_dates?: unknown }>) {
      const dates = row.scheduled_next_dates;
      if (!Array.isArray(dates)) continue;
      for (const iso of dates) {
        if (typeof iso !== 'string') continue;
        const ts = Date.parse(iso);
        if (!Number.isFinite(ts) || ts <= now) continue;
        if (ts < bestTime) {
          bestTime = ts;
          bestTemplate = row;
        }
      }
    }

    if (!bestTemplate || !Number.isFinite(bestTime)) return null;
    return { template: bestTemplate, scheduledAt: new Date(bestTime) };
  } catch (err) {
    errorWithTs('[workout-scheduler] Unexpected error in getNextScheduledTemplate', err);
    return null;
  }
}
