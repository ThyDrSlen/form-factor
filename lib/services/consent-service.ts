/**
 * Consent Service
 * 
 * Manages user telemetry consent flags for privacy compliance.
 * Controls what data can be collected, uploaded, and retained.
 */

import { supabase } from '@/lib/supabase';
import { ensureUserId } from '@/lib/auth-utils';
import type { TelemetryConsent } from '@/lib/types/telemetry';

// =============================================================================
// Default Consent
// =============================================================================

const DEFAULT_CONSENT: TelemetryConsent = {
  allowAnonymousTelemetry: true,
  allowVideoUpload: false,
  allowTrainerLabeling: false,
  allowExtendedRetention: false,
};

// =============================================================================
// Cached Consent State
// =============================================================================

let cachedConsent: TelemetryConsent | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get user's telemetry consent settings
 * Returns cached value if available, otherwise fetches from DB
 */
export async function getConsent(): Promise<TelemetryConsent> {
  // Return cached value if still valid
  if (cachedConsent && Date.now() < cacheExpiry) {
    return { ...cachedConsent };
  }

  try {
    const userId = await ensureUserId();

    const { data, error } = await supabase
      .from('user_telemetry_consent')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) {
      // If no row exists, user hasn't set preferences yet - use defaults
      if (error.code === 'PGRST116') {
        cachedConsent = DEFAULT_CONSENT;
        cacheExpiry = Date.now() + CACHE_TTL_MS;
        return { ...DEFAULT_CONSENT };
      }
      throw error;
    }

    const consent: TelemetryConsent = {
      allowAnonymousTelemetry: data.allow_anonymous_telemetry ?? true,
      allowVideoUpload: data.allow_video_upload ?? false,
      allowTrainerLabeling: data.allow_trainer_labeling ?? false,
      allowExtendedRetention: data.allow_extended_retention ?? false,
    };

    cachedConsent = consent;
    cacheExpiry = Date.now() + CACHE_TTL_MS;

    return consent;
  } catch (error) {
    if (__DEV__) {
      console.warn('[consent-service] Failed to get consent, using defaults', error);
    }
    return { ...DEFAULT_CONSENT };
  }
}

/**
 * Update user's telemetry consent settings
 */
export async function updateConsent(consent: Partial<TelemetryConsent>): Promise<void> {
  try {
    const userId = await ensureUserId();

    const updateData: Record<string, unknown> = {
      user_id: userId,
      updated_at: new Date().toISOString(),
    };

    if (consent.allowAnonymousTelemetry !== undefined) {
      updateData.allow_anonymous_telemetry = consent.allowAnonymousTelemetry;
    }
    if (consent.allowVideoUpload !== undefined) {
      updateData.allow_video_upload = consent.allowVideoUpload;
    }
    if (consent.allowTrainerLabeling !== undefined) {
      updateData.allow_trainer_labeling = consent.allowTrainerLabeling;
    }
    if (consent.allowExtendedRetention !== undefined) {
      updateData.allow_extended_retention = consent.allowExtendedRetention;
    }

    const { error } = await supabase
      .from('user_telemetry_consent')
      .upsert(updateData, { onConflict: 'user_id' });

    if (error) {
      throw error;
    }

    // Invalidate cache
    cachedConsent = null;
    cacheExpiry = 0;

    if (__DEV__) {
      console.log('[consent-service] Consent updated', consent);
    }
  } catch (error) {
    if (__DEV__) {
      console.error('[consent-service] Failed to update consent', error);
    }
    throw error;
  }
}

/**
 * Invalidate cached consent (e.g., on logout)
 */
export function invalidateConsentCache(): void {
  cachedConsent = null;
  cacheExpiry = 0;
}

// =============================================================================
// Permission Checks
// =============================================================================

/**
 * Check if frame samples should be logged
 * Only logs if anonymous telemetry is allowed
 */
export async function shouldLogFrames(): Promise<boolean> {
  const consent = await getConsent();
  return consent.allowAnonymousTelemetry;
}

/**
 * Check if video should be uploaded
 */
export async function shouldUploadVideo(): Promise<boolean> {
  const consent = await getConsent();
  return consent.allowVideoUpload;
}

/**
 * Check if trainer labeling is allowed
 */
export async function canTrainersLabel(): Promise<boolean> {
  const consent = await getConsent();
  return consent.allowTrainerLabeling;
}

/**
 * Check if extended retention is allowed
 */
export async function hasExtendedRetention(): Promise<boolean> {
  const consent = await getConsent();
  return consent.allowExtendedRetention;
}

// =============================================================================
// Synchronous Permission Checks (use cached value)
// =============================================================================

/**
 * Synchronous check for frame logging (uses cache, may be stale)
 * Falls back to default if cache is empty
 */
export function shouldLogFramesSync(): boolean {
  if (cachedConsent && Date.now() < cacheExpiry) {
    return cachedConsent.allowAnonymousTelemetry;
  }
  return DEFAULT_CONSENT.allowAnonymousTelemetry;
}

/**
 * Synchronous check for video upload (uses cache, may be stale)
 */
export function shouldUploadVideoSync(): boolean {
  if (cachedConsent && Date.now() < cacheExpiry) {
    return cachedConsent.allowVideoUpload;
  }
  return DEFAULT_CONSENT.allowVideoUpload;
}

// =============================================================================
// Consent UI Helpers
// =============================================================================

/**
 * Get human-readable consent descriptions
 */
export const CONSENT_DESCRIPTIONS = {
  allowAnonymousTelemetry: {
    title: 'Anonymous Telemetry',
    description: 'Share anonymized usage data to help improve the app. No video or personal information is included.',
  },
  allowVideoUpload: {
    title: 'Video Upload for Research',
    description: 'Allow uploading workout videos for model training. Videos are stored securely and only used for improving form detection.',
  },
  allowTrainerLabeling: {
    title: 'Trainer Review',
    description: 'Allow certified trainers to review and label your workout videos for quality assurance.',
  },
  allowExtendedRetention: {
    title: 'Extended Data Retention',
    description: 'Keep your detailed workout data for up to 1 year (instead of 60 days) for long-term progress analysis.',
  },
} as const;
