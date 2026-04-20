/**
 * React hook wrapper around FormTrackingSettings.
 *
 * Subscribes to an in-process event bus so every mounted consumer stays in
 * sync when any one of them mutates the persisted settings — no Redux, no
 * Context dependency; just AsyncStorage + a local emitter.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_FORM_TRACKING_SETTINGS,
  type FormTrackingExerciseOverride,
  type FormTrackingGlobalSettings,
  type FormTrackingSettings,
  clearExerciseOverride as clearOverrideSvc,
  loadSettings,
  resetToDefaults as resetSvc,
  resolveExerciseSettings,
  setExerciseOverride as setOverrideSvc,
  updateSettings as updateSvc,
} from '@/lib/services/form-tracking-settings';

type Listener = (next: FormTrackingSettings) => void;

const listeners = new Set<Listener>();

function emit(next: FormTrackingSettings) {
  for (const listener of listeners) {
    try {
      listener(next);
    } catch {
      // consumer threw; ignore so the remaining listeners still fire.
    }
  }
}

export type UseFormTrackingSettingsResult = {
  settings: FormTrackingSettings;
  loading: boolean;
  update: (partial: Partial<FormTrackingGlobalSettings>) => Promise<FormTrackingSettings>;
  setOverride: (
    exerciseId: string,
    override: FormTrackingExerciseOverride,
  ) => Promise<FormTrackingSettings>;
  clearOverride: (exerciseId: string) => Promise<FormTrackingSettings>;
  reset: () => Promise<FormTrackingSettings>;
  resolve: (exerciseId: string | undefined) => FormTrackingGlobalSettings;
};

export function useFormTrackingSettings(): UseFormTrackingSettingsResult {
  const [settings, setSettings] = useState<FormTrackingSettings>(() => ({
    ...DEFAULT_FORM_TRACKING_SETTINGS,
    perExerciseOverrides: {},
  }));
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const loaded = await loadSettings();
        if (!cancelled && mountedRef.current) {
          setSettings(loaded);
          setLoading(false);
        }
      } catch {
        if (!cancelled && mountedRef.current) setLoading(false);
      }
    })();

    const listener: Listener = (next) => {
      if (mountedRef.current) setSettings(next);
    };
    listeners.add(listener);

    return () => {
      mountedRef.current = false;
      cancelled = true;
      listeners.delete(listener);
    };
  }, []);

  const update = useCallback<UseFormTrackingSettingsResult['update']>(async (partial) => {
    const next = await updateSvc(partial);
    emit(next);
    return next;
  }, []);

  const setOverride = useCallback<UseFormTrackingSettingsResult['setOverride']>(
    async (exerciseId, override) => {
      const next = await setOverrideSvc(exerciseId, override);
      emit(next);
      return next;
    },
    [],
  );

  const clearOverride = useCallback<UseFormTrackingSettingsResult['clearOverride']>(
    async (exerciseId) => {
      const next = await clearOverrideSvc(exerciseId);
      emit(next);
      return next;
    },
    [],
  );

  const reset = useCallback<UseFormTrackingSettingsResult['reset']>(async () => {
    const next = await resetSvc();
    emit(next);
    return next;
  }, []);

  const resolve = useCallback<UseFormTrackingSettingsResult['resolve']>(
    (exerciseId) => resolveExerciseSettings(settings, exerciseId),
    [settings],
  );

  return { settings, loading, update, setOverride, clearOverride, reset, resolve };
}

export function __clearListenersForTests(): void {
  listeners.clear();
}
