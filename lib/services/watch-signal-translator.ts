/**
 * Watch signal → natural-language cue translator.
 *
 * Turns cheap Apple Watch sensor features (HR, cadence, phase, eccentric
 * duration) into a single short coaching line. A rules-based static
 * translator ships today; an on-device Gemma runner can be plugged in later
 * via `setWatchSignalTranslator()` without touching any call-site.
 *
 * Rule evaluation is priority-ordered — first match wins. HR-ratio rules are
 * skipped entirely when `hrMaxBpm` is ≤ 0 to avoid divide-by-zero and
 * nonsense outputs.
 */

// =============================================================================
// Types
// =============================================================================

export type WatchPhaseState = 'warmup' | 'working' | 'rest' | 'cooldown';

export interface WatchSignals {
  hrBpm: number;
  hrMaxBpm: number;
  cadenceRpm: number;
  phaseState: WatchPhaseState;
  /** Seconds spent in the eccentric phase of the last rep. 0 = unknown. */
  lastRepEccentricSec: number;
}

export type CueTone = 'chill' | 'neutral' | 'urgent';

export interface TranslatedCue {
  cue: string;
  tone: CueTone;
  source: 'static' | 'gemma-local' | 'gemma-cloud';
}

export interface WatchSignalTranslator {
  translate(signals: WatchSignals): Promise<TranslatedCue>;
}

// =============================================================================
// Static rules-based translator
// =============================================================================

const DEFAULT_CUE: TranslatedCue = {
  cue: 'Nothing flagged — keep going.',
  tone: 'chill',
  source: 'static',
};

export const staticWatchSignalTranslator: WatchSignalTranslator = {
  async translate(signals: WatchSignals): Promise<TranslatedCue> {
    const { hrBpm, hrMaxBpm, phaseState, lastRepEccentricSec } = signals;
    const hrRatioValid = hrMaxBpm > 0;
    const hrRatio = hrRatioValid ? hrBpm / hrMaxBpm : 0;

    // Rule 1 — working + redlining HR
    if (hrRatioValid && phaseState === 'working' && hrRatio >= 0.9) {
      return {
        cue: "Breathe between reps — you're redlining.",
        tone: 'urgent',
        source: 'static',
      };
    }

    // Rule 2 — working + very low HR (too easy)
    if (hrRatioValid && phaseState === 'working' && hrRatio < 0.6) {
      return {
        cue: "Plenty of gas — pick up the pace if the form's clean.",
        tone: 'chill',
        source: 'static',
      };
    }

    // Rule 3 — working + eccentric too fast
    if (
      phaseState === 'working' &&
      lastRepEccentricSec > 0 &&
      lastRepEccentricSec < 0.6
    ) {
      return {
        cue: 'Slow the eccentric — 2 seconds down per rep.',
        tone: 'neutral',
        source: 'static',
      };
    }

    // Rule 4 — rest + HR not recovered
    if (hrRatioValid && phaseState === 'rest' && hrRatio > 0.75) {
      return {
        cue: "Stretch rest another 30s — HR hasn't recovered.",
        tone: 'neutral',
        source: 'static',
      };
    }

    // Rule 5 — warmup HR still too low
    if (hrRatioValid && phaseState === 'warmup' && hrRatio < 0.4) {
      return {
        cue: 'Bump the pace — warmup HR is still low.',
        tone: 'chill',
        source: 'static',
      };
    }

    // Default
    return DEFAULT_CUE;
  },
};

// =============================================================================
// Pluggable singleton — swap in Gemma (or any runner) at runtime
// =============================================================================

let activeRunner: WatchSignalTranslator = staticWatchSignalTranslator;

/** Return the currently-active translator. */
export function getWatchSignalTranslator(): WatchSignalTranslator {
  return activeRunner;
}

/**
 * Install a custom runner (e.g. Gemma via Cactus) once it has loaded.
 * Pass `null` to revert to the static translator. Safe to call multiple
 * times — last write wins.
 */
export function setWatchSignalTranslator(
  runner: WatchSignalTranslator | null,
): void {
  activeRunner = runner ?? staticWatchSignalTranslator;
}

/** Reset hook for tests — restores static translator. */
export function __resetWatchSignalTranslatorForTests(): void {
  activeRunner = staticWatchSignalTranslator;
}
