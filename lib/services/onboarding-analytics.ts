/**
 * Onboarding Analytics Service
 *
 * Tracks user progress through the onboarding flow.
 * Logs to console in dev, persists to Supabase `onboarding_events` table
 * in production. Respects telemetry consent via shouldLogFramesSync().
 */

import { supabase } from '@/lib/supabase';
import { ensureUserId } from '@/lib/auth-utils';
import { shouldLogFramesSync } from '@/lib/services/consent-service';
import { logWithTs, warnWithTs } from '@/lib/logger';

// =============================================================================
// Types
// =============================================================================

export type OnboardingEventType =
  | 'onboarding_start'
  | 'step_view'
  | 'step_complete'
  | 'step_skip'
  | 'onboarding_complete';

export type OnboardingStepName =
  | 'nutrition-goals'
  | 'arkit-permissions'
  | 'arkit-usage';

interface OnboardingEvent {
  event_type: OnboardingEventType;
  step_name: OnboardingStepName;
  timestamp: string;
  user_id: string;
}

// =============================================================================
// Core
// =============================================================================

/**
 * Track an onboarding event. Checks consent before logging.
 * Fails silently if the table doesn't exist or if the user isn't authenticated.
 */
export async function trackOnboardingEvent(
  eventType: OnboardingEventType,
  stepName: OnboardingStepName,
): Promise<void> {
  if (!shouldLogFramesSync()) return;

  const timestamp = new Date().toISOString();

  try {
    const userId = await ensureUserId();

    const event: OnboardingEvent = {
      event_type: eventType,
      step_name: stepName,
      timestamp,
      user_id: userId,
    };

    if (__DEV__) {
      logWithTs('[onboarding-analytics]', eventType, stepName);
    }

    // Insert into Supabase — fail silently if table doesn't exist yet
    const { error } = await supabase
      .from('onboarding_events')
      .insert(event);

    if (error && __DEV__) {
      warnWithTs('[onboarding-analytics] Insert failed (table may not exist yet)', error.message);
    }
  } catch {
    // Fail silently — user may not be authenticated or network may be down
    if (__DEV__) {
      warnWithTs('[onboarding-analytics] Failed to track event', eventType, stepName);
    }
  }
}
