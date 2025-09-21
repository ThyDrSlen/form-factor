import Constants from 'expo-constants';
import { Platform } from 'react-native';

export interface AppError {
  domain: 'network' | 'oauth' | 'session' | 'validation' | 'camera' | 'ml' | 'storage' | 'sync' | 'auth' | 'unknown';
  code: string;
  message: string;
  details?: unknown;
  retryable: boolean;
  severity: 'info' | 'warning' | 'error' | 'critical';
}

export interface ErrorContext {
  feature: 'auth' | 'form-feedback' | 'workouts' | 'ui' | 'app';
  location?: string;
  meta?: Record<string, unknown>;
}

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
    default:
      return 'Something went wrong. Please try again.';
  }
}

export function logError(err: AppError, ctx?: ErrorContext): void {
  // Redact potentially sensitive details before logging
  const safeDetails = sanitizeDetails(err.details);
  // Structured console logging for now; can be routed to Sentry later
  // Keep logs lightweight and consistent
  // eslint-disable-next-line no-console
  console.error('[Error]', {
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
