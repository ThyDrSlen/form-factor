/**
 * Safe haptics wrapper.
 *
 * `expo-haptics` returns a Promise that can reject when a device has disabled
 * haptics, is out of power, or is otherwise unavailable. These rejections are
 * never interesting to the call site — they would crash React Native when
 * logged as unhandled rejections and have no recovery path. This helper
 * centralises the catch so hot-path callers can fire-and-forget without
 * remembering `.catch()` or wrapping in `try/catch`.
 *
 * Usage:
 *   safeHaptic.notification('success');
 *   safeHaptic.impact('medium');
 *   safeHaptic.selection();
 */
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { warnWithTs } from '@/lib/logger';

type NotificationType = 'success' | 'warning' | 'error';
type ImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';

const NOTIFICATION_MAP: Record<NotificationType, Haptics.NotificationFeedbackType> = {
  success: Haptics.NotificationFeedbackType.Success,
  warning: Haptics.NotificationFeedbackType.Warning,
  error: Haptics.NotificationFeedbackType.Error,
};

const IMPACT_MAP: Record<ImpactStyle, Haptics.ImpactFeedbackStyle> = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
  rigid: Haptics.ImpactFeedbackStyle.Rigid,
  soft: Haptics.ImpactFeedbackStyle.Soft,
};

let loggedFailure = false;

function swallow(error: unknown): void {
  // Haptic failures are expected on unsupported devices. Log once per session
  // at warn level so we don't spam logs but still have breadcrumbs if a
  // regression starts rejecting on every call.
  if (loggedFailure) return;
  loggedFailure = true;
  if (__DEV__) {
    warnWithTs('[safeHaptic] Haptic call failed (suppressed further warnings)', error);
  }
}

function isHapticsSupported(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

export const safeHaptic = {
  /**
   * Fire a notification-level haptic (success / warning / error).
   * Never throws, never returns a rejected promise.
   */
  notification(type: NotificationType): void {
    if (!isHapticsSupported()) return;
    const mapped = NOTIFICATION_MAP[type];
    Haptics.notificationAsync(mapped).catch(swallow);
  },

  /**
   * Fire an impact-level haptic (light / medium / heavy / rigid / soft).
   * Never throws, never returns a rejected promise.
   */
  impact(style: ImpactStyle): void {
    if (!isHapticsSupported()) return;
    const mapped = IMPACT_MAP[style];
    Haptics.impactAsync(mapped).catch(swallow);
  },

  /**
   * Fire a selection-level haptic.
   * Never throws, never returns a rejected promise.
   */
  selection(): void {
    if (!isHapticsSupported()) return;
    Haptics.selectionAsync().catch(swallow);
  },
};

/**
 * Reset the once-per-session warn gate. Test-only.
 */
export function __resetSafeHapticState(): void {
  loggedFailure = false;
}

export type SafeHapticNotificationType = NotificationType;
export type SafeHapticImpactStyle = ImpactStyle;
