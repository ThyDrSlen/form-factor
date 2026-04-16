/**
 * Form Tracking Settings Service
 *
 * Persists user preferences that tune form-tracking sensitivity and feedback
 * modalities. Global defaults can be overridden per-exercise, letting users
 * dial in the feel they want for each movement without touching the others.
 *
 * Backed by AsyncStorage to stay offline-first; no Supabase round-trip.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'form_tracking_settings_v1';

export type CueVerbosity = 'minimal' | 'standard' | 'detailed';

export type FormTrackingGlobalSettings = {
  fqiThreshold: number;
  cueVerbosity: CueVerbosity;
  hapticsEnabled: boolean;
  voiceEnabled: boolean;
  overlayOpacity: number;
  autoPauseOnFault: boolean;
  countAudioEnabled: boolean;
};

export type FormTrackingExerciseOverride = Partial<FormTrackingGlobalSettings>;

export type FormTrackingSettings = FormTrackingGlobalSettings & {
  perExerciseOverrides: Record<string, FormTrackingExerciseOverride>;
};

export const FQI_THRESHOLD_MIN = 0.4;
export const FQI_THRESHOLD_MAX = 0.95;
export const OVERLAY_OPACITY_MIN = 0.2;
export const OVERLAY_OPACITY_MAX = 1.0;

export const DEFAULT_FORM_TRACKING_SETTINGS: FormTrackingSettings = {
  fqiThreshold: 0.7,
  cueVerbosity: 'standard',
  hapticsEnabled: true,
  voiceEnabled: false,
  overlayOpacity: 0.85,
  autoPauseOnFault: false,
  countAudioEnabled: true,
  perExerciseOverrides: {},
};

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function sanitizeGlobal(partial: Partial<FormTrackingGlobalSettings>): Partial<FormTrackingGlobalSettings> {
  const out: Partial<FormTrackingGlobalSettings> = {};
  if (partial.fqiThreshold !== undefined) {
    out.fqiThreshold = clamp(partial.fqiThreshold, FQI_THRESHOLD_MIN, FQI_THRESHOLD_MAX);
  }
  if (partial.overlayOpacity !== undefined) {
    out.overlayOpacity = clamp(partial.overlayOpacity, OVERLAY_OPACITY_MIN, OVERLAY_OPACITY_MAX);
  }
  if (partial.cueVerbosity !== undefined && ['minimal', 'standard', 'detailed'].includes(partial.cueVerbosity)) {
    out.cueVerbosity = partial.cueVerbosity;
  }
  if (typeof partial.hapticsEnabled === 'boolean') out.hapticsEnabled = partial.hapticsEnabled;
  if (typeof partial.voiceEnabled === 'boolean') out.voiceEnabled = partial.voiceEnabled;
  if (typeof partial.autoPauseOnFault === 'boolean') out.autoPauseOnFault = partial.autoPauseOnFault;
  if (typeof partial.countAudioEnabled === 'boolean') out.countAudioEnabled = partial.countAudioEnabled;
  return out;
}

function mergeWithDefaults(raw: unknown): FormTrackingSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_FORM_TRACKING_SETTINGS, perExerciseOverrides: {} };
  const input = raw as Partial<FormTrackingSettings>;
  const sanitizedGlobal = sanitizeGlobal(input);
  const overrides: Record<string, FormTrackingExerciseOverride> = {};
  if (input.perExerciseOverrides && typeof input.perExerciseOverrides === 'object') {
    for (const [exerciseId, override] of Object.entries(input.perExerciseOverrides)) {
      if (!override || typeof override !== 'object') continue;
      const sanitized = sanitizeGlobal(override as Partial<FormTrackingGlobalSettings>);
      if (Object.keys(sanitized).length > 0) overrides[exerciseId] = sanitized;
    }
  }
  return {
    ...DEFAULT_FORM_TRACKING_SETTINGS,
    ...sanitizedGlobal,
    perExerciseOverrides: overrides,
  };
}

export async function loadSettings(): Promise<FormTrackingSettings> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_FORM_TRACKING_SETTINGS, perExerciseOverrides: {} };
    return mergeWithDefaults(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_FORM_TRACKING_SETTINGS, perExerciseOverrides: {} };
  }
}

export async function saveSettings(settings: FormTrackingSettings): Promise<void> {
  const normalized = mergeWithDefaults(settings);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
}

export async function updateSettings(
  partial: Partial<FormTrackingGlobalSettings>,
): Promise<FormTrackingSettings> {
  const current = await loadSettings();
  const next: FormTrackingSettings = {
    ...current,
    ...sanitizeGlobal(partial),
  };
  await saveSettings(next);
  return next;
}

export async function setExerciseOverride(
  exerciseId: string,
  override: FormTrackingExerciseOverride,
): Promise<FormTrackingSettings> {
  if (!exerciseId) throw new Error('exerciseId required');
  const current = await loadSettings();
  const sanitized = sanitizeGlobal(override);
  const next: FormTrackingSettings = {
    ...current,
    perExerciseOverrides: {
      ...current.perExerciseOverrides,
      [exerciseId]: {
        ...(current.perExerciseOverrides[exerciseId] ?? {}),
        ...sanitized,
      },
    },
  };
  await saveSettings(next);
  return next;
}

export async function clearExerciseOverride(exerciseId: string): Promise<FormTrackingSettings> {
  const current = await loadSettings();
  if (!(exerciseId in current.perExerciseOverrides)) return current;
  const { [exerciseId]: _removed, ...rest } = current.perExerciseOverrides;
  const next: FormTrackingSettings = { ...current, perExerciseOverrides: rest };
  await saveSettings(next);
  return next;
}

export async function resetToDefaults(): Promise<FormTrackingSettings> {
  const next = { ...DEFAULT_FORM_TRACKING_SETTINGS, perExerciseOverrides: {} };
  await saveSettings(next);
  return next;
}

export function resolveExerciseSettings(
  settings: FormTrackingSettings,
  exerciseId: string | undefined,
): FormTrackingGlobalSettings {
  const { perExerciseOverrides, ...global } = settings;
  if (!exerciseId) return global;
  const override = perExerciseOverrides[exerciseId];
  if (!override) return global;
  return { ...global, ...override };
}

export function __resetForTests(): Promise<void> {
  return AsyncStorage.removeItem(STORAGE_KEY);
}
