/**
 * Cue Priority Audio
 *
 * Maps a fault severity level to audio playback hints that the premium
 * cue audio hook can use to vary urgency. Exists as its own module so
 * the mapping can be tuned / A/B tested without touching the hook.
 *
 * Severity convention matches lib/types/workout-definitions.FaultSeverity:
 *   1 = minor     → slower reminders, no haptic
 *   2 = moderate  → normal cadence, light haptic
 *   3 = major     → assertive cadence, medium haptic + repeat
 */
import type { FaultSeverity } from '@/lib/types/workout-definitions';

export type CuePriority = 'low' | 'normal' | 'high';

export type CueHaptic = 'none' | 'light' | 'medium' | 'heavy';

export interface CueAudioHint {
  priority: CuePriority;
  intervalMs: number;
  volume: number; // 0..1
  haptic: CueHaptic;
  repeatIfUnadopted: boolean;
}

export interface MapOptions {
  /** Bump priority when the athlete is already fatigued */
  isFatigued?: boolean;
  /** Scan overlay is already voicing a same-severity cue */
  isActiveCue?: boolean;
}

const TABLE: Record<CuePriority, CueAudioHint> = {
  low: {
    priority: 'low',
    intervalMs: 4000,
    volume: 0.6,
    haptic: 'none',
    repeatIfUnadopted: false,
  },
  normal: {
    priority: 'normal',
    intervalMs: 2200,
    volume: 0.85,
    haptic: 'light',
    repeatIfUnadopted: true,
  },
  high: {
    priority: 'high',
    intervalMs: 1400,
    volume: 1.0,
    haptic: 'medium',
    repeatIfUnadopted: true,
  },
};

export function severityToPriority(severity: FaultSeverity | number | undefined): CuePriority {
  const s = Number(severity ?? 0);
  if (s >= 3) return 'high';
  if (s >= 2) return 'normal';
  return 'low';
}

/**
 * Resolve audio hints for a given fault severity. Optionally elevate
 * priority when fatigued.
 */
export function mapSeverityToAudioHint(
  severity: FaultSeverity | number | undefined,
  options: MapOptions = {},
): CueAudioHint {
  let priority = severityToPriority(severity);
  if (options.isFatigued && priority === 'normal') priority = 'high';
  if (options.isFatigued && priority === 'low') priority = 'normal';

  const base = TABLE[priority];
  // Active repeat cue gets a slightly longer cooldown so we don't stack.
  if (options.isActiveCue && base.repeatIfUnadopted) {
    return { ...base, intervalMs: base.intervalMs + 400 };
  }
  return base;
}

/** Exported for test assertions on table constants. */
export const CUE_AUDIO_TABLE = TABLE;
