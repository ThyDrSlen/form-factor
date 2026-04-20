/**
 * Haptic Bus
 *
 * Cross-platform, typed event bus that maps form-tracking events onto an
 * appropriate haptic pattern. On iOS we use expo-haptics' notification /
 * impact APIs. On Android we fall back to the RN `Vibration` module because
 * expo-haptics support on Android is partial and inconsistent across
 * manufacturers.
 *
 * The bus owns:
 *   - A typed `emit(event)` entry point with per-event debounce so rapid
 *     rep completions don't turn the phone into a buzzer.
 *   - An `onEvent` subscription API used by downstream observers (e.g.
 *     audio cues, analytics).
 *   - Runtime-switchable `enabled` + `mode` flags so the user's
 *     preferences context can toggle haptics without reloading the app.
 */

import { Platform, Vibration } from 'react-native';
import * as Haptics from 'expo-haptics';

// ---------------------------------------------------------------------------
// Event + severity model
// ---------------------------------------------------------------------------

export type HapticEvent =
  | 'rep.complete'
  | 'fault.critical'
  | 'fault.warning'
  | 'tracking.lost'
  | 'tracking.recovered'
  | 'calibration.complete'
  | 'calibration.failed'
  | 'rest.tick10s'
  | 'rest.done'
  | 'pr.hit'
  | 'fqi.bucket-down'
  | 'fqi.bucket-up';

export type HapticSeverity = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

export const EVENT_TO_SEVERITY: Record<HapticEvent, HapticSeverity> = {
  'rep.complete': 'light',
  'fault.critical': 'error',
  'fault.warning': 'warning',
  'tracking.lost': 'warning',
  'tracking.recovered': 'success',
  'calibration.complete': 'success',
  'calibration.failed': 'error',
  'rest.tick10s': 'light',
  'rest.done': 'success',
  'pr.hit': 'success',
  'fqi.bucket-down': 'warning',
  'fqi.bucket-up': 'light',
};

/**
 * Per-event minimum spacing (ms) between consecutive haptics. `rep.complete`
 * is noisy (can fire 10+ times per set), so we enforce a strict debounce.
 */
export const EVENT_DEBOUNCE_MS: Record<HapticEvent, number> = {
  'rep.complete': 300,
  'fault.critical': 500,
  'fault.warning': 600,
  'tracking.lost': 800,
  'tracking.recovered': 400,
  'calibration.complete': 250,
  'calibration.failed': 250,
  'rest.tick10s': 900,
  'rest.done': 300,
  'pr.hit': 250,
  'fqi.bucket-down': 1000,
  'fqi.bucket-up': 1000,
};

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export type HapticMode = 'all' | 'critical-only' | 'off';

/** Events still allowed in 'critical-only' mode. */
const CRITICAL_EVENTS: ReadonlySet<HapticEvent> = new Set([
  'fault.critical',
  'tracking.lost',
  'calibration.failed',
  'rest.done',
  'pr.hit',
]);

// ---------------------------------------------------------------------------
// Android fallback patterns (ms)
// ---------------------------------------------------------------------------

const ANDROID_PATTERNS: Record<HapticSeverity, number | number[]> = {
  light: 15,
  medium: 25,
  heavy: 45,
  success: [0, 25, 60, 25],
  warning: [0, 30, 80, 30],
  error: [0, 40, 60, 40, 60, 40],
};

// ---------------------------------------------------------------------------
// Bus implementation
// ---------------------------------------------------------------------------

type EventListener = (event: HapticEvent) => void;

export interface HapticBus {
  emit(event: HapticEvent): void;
  onEvent(listener: EventListener): () => void;
  setEnabled(enabled: boolean): void;
  setMode(mode: HapticMode): void;
  getMode(): HapticMode;
  isEnabled(): boolean;
  /** Reset internal state (exposed for tests). */
  _reset(): void;
}

function createHapticBus(): HapticBus {
  const lastEmit = new Map<HapticEvent, number>();
  const listeners = new Set<EventListener>();
  let enabled = true;
  let mode: HapticMode = 'all';

  function shouldPlay(event: HapticEvent): boolean {
    if (!enabled) return false;
    if (mode === 'off') return false;
    if (mode === 'critical-only' && !CRITICAL_EVENTS.has(event)) return false;
    const debounce = EVENT_DEBOUNCE_MS[event] ?? 250;
    const last = lastEmit.get(event) ?? 0;
    const now = Date.now();
    // If the clock moved backward (e.g. fake timers reset in a test harness
    // or a system-clock correction in the wild), drop the stale mark so we
    // don't suppress legitimate emits.
    if (now < last) {
      lastEmit.set(event, now);
      return true;
    }
    if (now - last < debounce) return false;
    lastEmit.set(event, now);
    return true;
  }

  function play(severity: HapticSeverity): void {
    if (Platform.OS === 'ios') {
      try {
        switch (severity) {
          case 'light':
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            break;
          case 'medium':
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            break;
          case 'heavy':
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            break;
          case 'success':
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            break;
          case 'warning':
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            break;
          case 'error':
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            break;
        }
      } catch {
        /* native bridge not available — silent */
      }
      return;
    }

    if (Platform.OS === 'android') {
      try {
        const pattern = ANDROID_PATTERNS[severity];
        if (Array.isArray(pattern)) {
          Vibration.vibrate(pattern);
        } else {
          Vibration.vibrate(pattern);
        }
      } catch {
        /* Vibration not available — silent */
      }
      return;
    }
    /* web / other: no-op */
  }

  return {
    emit(event) {
      if (!shouldPlay(event)) return;
      const severity = EVENT_TO_SEVERITY[event];
      if (severity) play(severity);
      listeners.forEach((fn) => {
        try {
          fn(event);
        } catch {
          /* swallow listener failure */
        }
      });
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setEnabled(next) {
      enabled = Boolean(next);
    },
    setMode(next) {
      mode = next;
    },
    getMode() {
      return mode;
    },
    isEnabled() {
      return enabled && mode !== 'off';
    },
    _reset() {
      lastEmit.clear();
      listeners.clear();
      enabled = true;
      mode = 'all';
    },
  };
}

/** Module-level singleton. */
export const hapticBus: HapticBus = createHapticBus();
