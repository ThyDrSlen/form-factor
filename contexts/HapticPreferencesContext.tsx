/**
 * HapticPreferencesContext
 *
 * Persists per-user haptic preferences via AsyncStorage and mirrors the
 * resolved values into the module-level haptic bus. Also exposes
 * `toneOnly` which downstream audio-cue consumers read to decide whether
 * to play tone fallbacks instead of voice.
 *
 * Lightweight and dependency-free so it can be dropped into _layout.tsx
 * without reshuffling the existing provider nesting.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { hapticBus, type HapticMode } from '@/lib/haptics/haptic-bus';

const STORAGE_KEY = 'ff:haptic-preferences:v1';

export interface HapticPreferences {
  enabled: boolean;
  mode: HapticMode;
  toneOnly: boolean;
  colorBlindMode: 'off' | 'protanopia' | 'deuteranopia' | 'tritanopia' | 'high-contrast';
}

interface HapticPreferencesContextValue extends HapticPreferences {
  setEnabled: (enabled: boolean) => Promise<void>;
  setMode: (mode: HapticMode) => Promise<void>;
  setToneOnly: (toneOnly: boolean) => Promise<void>;
  setColorBlindMode: (mode: HapticPreferences['colorBlindMode']) => Promise<void>;
  loaded: boolean;
}

const DEFAULTS: HapticPreferences = {
  enabled: true,
  mode: 'all',
  toneOnly: false,
  colorBlindMode: 'off',
};

const HapticPreferencesContext = createContext<HapticPreferencesContextValue | null>(null);

async function loadStored(): Promise<Partial<HapticPreferences>> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<HapticPreferences>;
    return parsed ?? {};
  } catch {
    return {};
  }
}

async function saveStored(prefs: HapticPreferences): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore persistence errors — user settings re-default on next boot */
  }
}

export function HapticPreferencesProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<HapticPreferences>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    loadStored().then((stored) => {
      if (cancelled) return;
      const merged: HapticPreferences = {
        enabled: stored.enabled ?? DEFAULTS.enabled,
        mode: stored.mode ?? DEFAULTS.mode,
        toneOnly: stored.toneOnly ?? DEFAULTS.toneOnly,
        colorBlindMode: stored.colorBlindMode ?? DEFAULTS.colorBlindMode,
      };
      setPrefs(merged);
      setLoaded(true);
      hapticBus.setEnabled(merged.enabled);
      hapticBus.setMode(merged.mode);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Mirror prefs into the bus whenever they change.
  useEffect(() => {
    hapticBus.setEnabled(prefs.enabled);
    hapticBus.setMode(prefs.mode);
  }, [prefs.enabled, prefs.mode]);

  const persist = useCallback(async (next: HapticPreferences) => {
    setPrefs(next);
    await saveStored(next);
  }, []);

  const setEnabled = useCallback(
    async (enabled: boolean) => persist({ ...prefs, enabled }),
    [persist, prefs],
  );
  const setMode = useCallback(
    async (mode: HapticMode) => persist({ ...prefs, mode }),
    [persist, prefs],
  );
  const setToneOnly = useCallback(
    async (toneOnly: boolean) => persist({ ...prefs, toneOnly }),
    [persist, prefs],
  );
  const setColorBlindMode = useCallback(
    async (colorBlindMode: HapticPreferences['colorBlindMode']) =>
      persist({ ...prefs, colorBlindMode }),
    [persist, prefs],
  );

  const value = useMemo<HapticPreferencesContextValue>(
    () => ({
      ...prefs,
      loaded,
      setEnabled,
      setMode,
      setToneOnly,
      setColorBlindMode,
    }),
    [prefs, loaded, setEnabled, setMode, setToneOnly, setColorBlindMode],
  );

  return (
    <HapticPreferencesContext.Provider value={value}>{children}</HapticPreferencesContext.Provider>
  );
}

export function useHapticPreferences(): HapticPreferencesContextValue {
  const ctx = useContext(HapticPreferencesContext);
  if (!ctx) {
    // Non-throwing default so tests or deep-renders outside the provider
    // still get a usable (read-only) shape.
    return {
      ...DEFAULTS,
      loaded: false,
      setEnabled: async () => {},
      setMode: async () => {},
      setToneOnly: async () => {},
      setColorBlindMode: async () => {},
    };
  }
  return ctx;
}
