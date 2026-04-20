/**
 * useColorBlindMode
 *
 * Reads the persisted colorblind preference from HapticPreferencesContext
 * and returns the active mode plus the resolved palette. Caller-side
 * convenience over having every consumer destructure the raw preference
 * shape.
 */

import { useMemo } from 'react';
import { useHapticPreferences } from '@/contexts/HapticPreferencesContext';
import { PALETTES, type ColorBlindMode, type FqiPalette } from './color-blind-palette';

export interface UseColorBlindModeResult {
  mode: ColorBlindMode;
  palette: FqiPalette;
}

export function useColorBlindMode(): UseColorBlindModeResult {
  const prefs = useHapticPreferences();
  return useMemo<UseColorBlindModeResult>(
    () => ({
      mode: prefs.colorBlindMode,
      palette: PALETTES[prefs.colorBlindMode] ?? PALETTES.off,
    }),
    [prefs.colorBlindMode],
  );
}

export default useColorBlindMode;
