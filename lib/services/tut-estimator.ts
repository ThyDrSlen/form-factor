/**
 * Time Under Tension (TUT) Estimator
 *
 * Estimates TUT per set based on tempo notation and rep count.
 * Also supports measured TUT from form tracking (future).
 */

import type { TutSource } from '@/lib/types/workout-session';

// =============================================================================
// Types
// =============================================================================

export interface TutResult {
  tut_ms: number;
  tut_source: TutSource;
}

/**
 * Parse a tempo string like "2-0-2" or "3-1-2-0" into phase durations.
 *
 * Format: "eccentric-pauseBottom-concentric[-pauseTop]"
 * Examples:
 *   "2-0-2"   -> ecc=2, pauseBottom=0, con=2, pauseTop=0
 *   "3-1-2-0" -> ecc=3, pauseBottom=1, con=2, pauseTop=0
 *   "4-0-1-0" -> ecc=4, pauseBottom=0, con=1, pauseTop=0
 */
export interface TempoPhases {
  eccentric: number;
  pauseBottom: number;
  concentric: number;
  pauseTop: number;
}

// =============================================================================
// Parsing
// =============================================================================

/**
 * Parse a tempo string into phase durations.
 * Returns null if the string is invalid.
 */
export function parseTempo(tempo: string | null | undefined): TempoPhases | null {
  if (!tempo) return null;

  const parts = tempo.split('-').map(Number);
  if (parts.some(isNaN)) return null;

  if (parts.length === 3) {
    return {
      eccentric: parts[0],
      pauseBottom: parts[1],
      concentric: parts[2],
      pauseTop: 0,
    };
  }

  if (parts.length === 4) {
    return {
      eccentric: parts[0],
      pauseBottom: parts[1],
      concentric: parts[2],
      pauseTop: parts[3],
    };
  }

  return null;
}

// =============================================================================
// Estimation
// =============================================================================

/** Default tempo when none is specified: 2-0-2 */
const DEFAULT_TEMPO: TempoPhases = {
  eccentric: 2,
  pauseBottom: 0,
  concentric: 2,
  pauseTop: 0,
};

/**
 * Estimate TUT for a rep-based set using tempo and rep count.
 */
export function estimateTut(
  reps: number,
  tempo?: string | null,
): TutResult {
  const phases = parseTempo(tempo) ?? DEFAULT_TEMPO;
  const tutPerRep = phases.eccentric + phases.pauseBottom + phases.concentric + phases.pauseTop;
  const tutMs = Math.round(reps * tutPerRep * 1000);

  return {
    tut_ms: tutMs,
    tut_source: 'estimated',
  };
}

/**
 * Compute TUT for a timed set (duration = TUT).
 */
export function timedSetTut(actualSeconds: number): TutResult {
  return {
    tut_ms: Math.round(actualSeconds * 1000),
    tut_source: 'estimated',
  };
}

/**
 * Record measured TUT from form tracking.
 * This is called by the form tracking integration when rep-phase
 * timestamps are available.
 */
export function measuredTut(tutMs: number): TutResult {
  return {
    tut_ms: tutMs,
    tut_source: 'measured',
  };
}
