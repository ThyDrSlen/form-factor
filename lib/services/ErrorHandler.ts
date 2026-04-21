import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { errorWithTs } from '@/lib/logger';

export interface AppError {
  domain:
    | 'network'
    | 'oauth'
    | 'session'
    | 'validation'
    | 'camera'
    | 'ml'
    | 'storage'
    | 'sync'
    | 'auth'
    | 'coach'
    | 'form-tracking'
    | 'unknown';
  code: string;
  message: string;
  details?: unknown;
  retryable: boolean;
  severity: 'info' | 'warning' | 'error' | 'critical';
}

export interface ErrorContext {
  feature: 'auth' | 'form-feedback' | 'workouts' | 'ui' | 'app' | 'form-tracking' | 'coach';
  location?: string;
  meta?: Record<string, unknown>;
}

/**
 * Structured error codes for the form-tracking domain. Use these instead of
 * ad-hoc strings so dashboards and alerting can group the same failure mode
 * across the pipeline.
 */
export const FormTrackingErrorCode = {
  /** ROM/depth target range was non-positive or non-finite. */
  FQI_DEGENERATE_RANGE: 'FQI_DEGENERATE_RANGE',
  /** Rep logger insert/update failed against Supabase. */
  REP_LOG_PERSIST_FAILED: 'REP_LOG_PERSIST_FAILED',
  /** Skeleton was placed on a non-human object (HumanValidationGuard). */
  SUBJECT_NOT_HUMAN: 'SUBJECT_NOT_HUMAN',
  /** ARKit silently swapped which body it tracks (SubjectIdentityTracker). */
  SUBJECT_SWITCH_DETECTED: 'SUBJECT_SWITCH_DETECTED',
  /** Calibration failed to converge within the allotted frames. */
  CALIBRATION_FAILED: 'CALIBRATION_FAILED',
  /** A required joint was missing for too many consecutive frames. */
  JOINT_OCCLUSION_TIMEOUT: 'JOINT_OCCLUSION_TIMEOUT',
  /** Cue engine could not deliver a higher-priority cue mid-playback. */
  CUE_PREEMPTION_FAILED: 'CUE_PREEMPTION_FAILED',
  /** Session-runner state went out of sync with rep-logger expectations. */
  SESSION_STATE_DESYNC: 'SESSION_STATE_DESYNC',
  /** Rep data export (CSV/JSON) failed to generate or persist a file. */
  EXPORT_FAILED: 'EXPORT_FAILED',
} as const;
export type FormTrackingErrorCodeValue =
  typeof FormTrackingErrorCode[keyof typeof FormTrackingErrorCode];

export function createError(
  domain: AppError['domain'],
  code: string,
  message: string,
  opts?: Partial<Pick<AppError, 'details' | 'retryable' | 'severity'>>
): AppError {
  return {
    domain,
    code,
    message,
    retryable: opts?.retryable ?? false,
    severity: opts?.severity ?? 'error',
    details: opts?.details,
  };
}

export function mapToUserMessage(err: AppError): string {
  // Specific codes can override the domain-default copy.
  if (err.code === 'COACH_RATE_LIMITED') {
    return 'Coach is rate-limited — try again in a moment.';
  }

  switch (err.domain) {
    case 'network':
      return 'Connection issue. Please check your internet and try again.';
    case 'oauth':
      if (err.code === 'OAUTH_CANCELLED') return 'Sign-in was cancelled.';
      if (err.code === 'OAUTH_DISMISSED') return 'Sign-in was dismissed.';
      return 'Authentication failed while contacting the provider.';
    case 'session':
      return 'Your session could not be validated. Please try signing in again.';
    case 'validation':
      return 'App configuration is incomplete. Please contact support.';
    case 'camera':
      return 'Camera is unavailable or permission was denied.';
    case 'ml':
      return 'Processing issue. Try again or adjust your position.';
    case 'storage':
      return 'We had trouble saving your data. Please try again.';
    case 'sync':
      return 'Sync issue. We will retry automatically when online.';
    case 'auth':
      return 'Authentication error. Please try again.';
    case 'coach':
      return 'Coach service hit an issue. Please try again.';
    case 'form-tracking':
      return mapFormTrackingMessage(err.code);
    default:
      return 'Something went wrong. Please try again.';
  }
}

export function logError(err: AppError, ctx?: ErrorContext): void {
  // Redact potentially sensitive details before logging
  const safeDetails = sanitizeDetails(err.details);
  // Structured console logging for now; can be routed to Sentry later
  // Keep logs lightweight and consistent
   
  errorWithTs('[Error]', {
    domain: err.domain,
    code: err.code,
    message: err.message,
    retryable: err.retryable,
    severity: err.severity,
    details: safeDetails,
    ctx,
    platform: Platform.OS,
    appVersion: (Constants.expoConfig as any)?.version ?? 'unknown',
  });
}

export function shouldRetry(err: AppError): boolean {
  if (typeof err.retryable === 'boolean') return err.retryable;
  return err.domain === 'network' || err.domain === 'sync';
}

export async function withErrorHandling<T>(
  fn: () => Promise<T>,
  buildError: (e: unknown) => AppError,
  ctx?: ErrorContext
): Promise<{ ok: true; data: T } | { ok: false; error: AppError }> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (e) {
    const appError = buildError(e);
    logError(appError, ctx);
    return { ok: false, error: appError };
  }
}

function mapFormTrackingMessage(code: string): string {
  switch (code) {
    case FormTrackingErrorCode.SUBJECT_NOT_HUMAN:
      return 'Tracking lost a clear view of you. Adjust your camera and try again.';
    case FormTrackingErrorCode.SUBJECT_SWITCH_DETECTED:
      return 'Another person stepped into the frame. Counting paused — confirm to continue.';
    case FormTrackingErrorCode.CALIBRATION_FAILED:
      return 'Could not calibrate. Make sure your full body is in frame and hold still.';
    case FormTrackingErrorCode.JOINT_OCCLUSION_TIMEOUT:
      return 'Some joints were hidden too long. Reframe so your whole body is visible.';
    case FormTrackingErrorCode.FQI_DEGENERATE_RANGE:
      return 'Form scoring skipped a metric (range mis-configured). Other metrics still applied.';
    case FormTrackingErrorCode.REP_LOG_PERSIST_FAILED:
      return 'A rep was not saved. We will retry automatically when online.';
    case FormTrackingErrorCode.CUE_PREEMPTION_FAILED:
      return 'A coaching cue could not be played. Continuing without it.';
    case FormTrackingErrorCode.SESSION_STATE_DESYNC:
      return 'Session state got out of sync. Restart the set to continue.';
    case FormTrackingErrorCode.EXPORT_FAILED:
      return 'Export failed. Please try again.';
    default:
      return 'Form tracking ran into an issue. Try repositioning your camera.';
  }
}

function sanitizeDetails(details: unknown): unknown {
  if (!details) return undefined;
  if (details instanceof Error) {
    return { name: details.name, message: details.message, stack: details.stack };
  }
  try {
    JSON.stringify(details);
    return details;
  } catch {
    return String(details);
  }
}
