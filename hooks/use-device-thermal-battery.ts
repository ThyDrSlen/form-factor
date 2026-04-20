/**
 * useDeviceThermalBattery
 *
 * Combines battery level (when available) with the thermal-monitor stub
 * (TODO(#449)) and exposes a single `{ batteryLevel, thermalState,
 * shouldPauseLowPower }` object for the badge + auto-pause logic.
 *
 * Battery level: tries `expo-battery` lazily so this hook stays buildable
 * when the dep is not yet installed (per overnight no-new-deps rule). When
 * the dep is missing, `batteryLevel` is `null` and the auto-pause guard
 * relies solely on thermal state.
 *
 * Bucketing:
 *   - batteryLevel < 0.10 OR thermalState ∈ {serious, critical} → pause
 *   - batteryLevel < 0.20 OR thermalState = fair → warn (badge yellow)
 *   - otherwise → normal (badge hidden)
 */

import { useEffect, useState } from 'react';
import {
  getThermalState,
  subscribeThermalState,
  type ThermalState,
} from '@/lib/services/thermal-monitor';

export type DeviceBadgeLevel = 'normal' | 'warn' | 'critical';

export interface UseDeviceThermalBatteryReturn {
  /** Battery level 0-1, or `null` when battery API is unavailable. */
  batteryLevel: number | null;
  thermalState: ThermalState;
  /** Aggregated badge bucket the UI consumes. */
  badgeLevel: DeviceBadgeLevel;
  /** Whether the controller should auto-pause active reps. */
  shouldPauseLowPower: boolean;
}

const POLL_INTERVAL_MS = 30_000; // Poll every 30s — battery does not change quickly.

/**
 * Lazy-load expo-battery so the bundler does not fail when the dep is not
 * installed. Returns null on failure or web.
 */
async function readBatteryLevel(): Promise<number | null> {
  try {
    // Avoid static import so missing dep does not break the bundle.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-battery');
    if (!mod || typeof mod.getBatteryLevelAsync !== 'function') return null;
    const level = await mod.getBatteryLevelAsync();
    return typeof level === 'number' && Number.isFinite(level) ? level : null;
  } catch {
    return null;
  }
}

export function deriveBadgeLevel(
  batteryLevel: number | null,
  thermalState: ThermalState
): DeviceBadgeLevel {
  if (thermalState === 'serious' || thermalState === 'critical') return 'critical';
  if (batteryLevel !== null && batteryLevel < 0.1) return 'critical';
  if (thermalState === 'fair') return 'warn';
  if (batteryLevel !== null && batteryLevel < 0.2) return 'warn';
  return 'normal';
}

export function deriveShouldPause(
  batteryLevel: number | null,
  thermalState: ThermalState
): boolean {
  if (thermalState === 'critical') return true;
  if (thermalState === 'serious') return true;
  if (batteryLevel !== null && batteryLevel < 0.1) return true;
  return false;
}

export function useDeviceThermalBattery(): UseDeviceThermalBatteryReturn {
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [thermalState, setThermalState] = useState<ThermalState>(() => getThermalState());

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      const level = await readBatteryLevel();
      if (!cancelled) setBatteryLevel(level);
    };

    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);

    const unsubscribe = subscribeThermalState((state) => {
      if (!cancelled) setThermalState(state);
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      unsubscribe();
    };
  }, []);

  const badgeLevel = deriveBadgeLevel(batteryLevel, thermalState);
  const shouldPauseLowPower = deriveShouldPause(batteryLevel, thermalState);

  return {
    batteryLevel,
    thermalState,
    badgeLevel,
    shouldPauseLowPower,
  };
}

export default useDeviceThermalBattery;
