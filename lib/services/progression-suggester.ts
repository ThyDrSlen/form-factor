/**
 * Progression Suggester
 *
 * Suggests the next working weight for a lift based on the last session's
 * average FQI and the last load used. Pure, deterministic, synchronous —
 * safe to call during render. No Supabase / SQLite dependencies.
 *
 * Rules (per product spec, issue #447 W3-C item #3):
 *   FQI >= 90  → increment (+5 lb / +2.5 kg)
 *   FQI 75-89  → maintain (same load)
 *   FQI <  75  → deload (-10% of last load, rounded to nearest plate unit)
 *
 * Safety: NaN / missing inputs return a `maintain` suggestion at the last
 * weight so the UI degrades gracefully; never emits negative or NaN weights.
 *
 * Issue #447 W3-C item #3.
 */

// =============================================================================
// Types
// =============================================================================

export type ProgressionRationale = 'increment' | 'maintain' | 'deload';
export type WeightUnit = 'lb' | 'kg';

export interface Suggestion {
  /** Suggested next weight for the first working set. */
  nextWeight: number;
  /** Machine-readable rationale for the suggestion. */
  rationale: ProgressionRationale;
  /** Short human-readable reason for the UI badge. */
  reason: string;
}

// =============================================================================
// Constants
// =============================================================================

export const FQI_INCREMENT_THRESHOLD = 90;
export const FQI_DELOAD_THRESHOLD = 75;

const INCREMENT_LB = 5;
const INCREMENT_KG = 2.5;
const DELOAD_RATIO = 0.9; // -10 %

// =============================================================================
// Internal helpers
// =============================================================================

function isFiniteNonNegative(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

function roundToPlate(weight: number, unit: WeightUnit): number {
  // Round to the smallest plate increment: 2.5 lb (micro) or 1.25 kg (micro).
  // Keeps the output tidy without requiring a full plate calculator.
  const step = unit === 'lb' ? 2.5 : 1.25;
  return Math.max(0, Math.round(weight / step) * step);
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Suggest the next working weight based on the last session's average FQI.
 *
 * @param exerciseId  The exercise (reserved — currently purely informational
 *                    but accepted so future per-exercise curves can be added
 *                    without breaking callers).
 * @param lastSessionAvgFqi  Average FQI from the previous session (0-100).
 *                    NaN / undefined triggers a `maintain` fallback.
 * @param lastWeight  The load used in the previous session in `unit`.
 * @param unit        Weight unit, `lb` or `kg`.
 */
export function suggestNextWeight(
  exerciseId: string,
  lastSessionAvgFqi: number,
  lastWeight: number,
  unit: WeightUnit = 'lb',
): Suggestion {
  const safeUnit: WeightUnit = unit === 'kg' ? 'kg' : 'lb';

  // --- Input guards --------------------------------------------------------
  if (!exerciseId || typeof exerciseId !== 'string') {
    return {
      nextWeight: isFiniteNonNegative(lastWeight) ? lastWeight : 0,
      rationale: 'maintain',
      reason: 'Missing exercise — maintaining last load',
    };
  }

  if (!isFiniteNonNegative(lastWeight)) {
    return {
      nextWeight: 0,
      rationale: 'maintain',
      reason: 'No prior load on record — enter your working weight',
    };
  }

  if (!isFiniteNonNegative(lastSessionAvgFqi)) {
    return {
      nextWeight: lastWeight,
      rationale: 'maintain',
      reason: 'Last form score unavailable — maintaining load',
    };
  }

  const fqi = Math.min(100, lastSessionAvgFqi);

  // --- Rule table ----------------------------------------------------------
  if (fqi >= FQI_INCREMENT_THRESHOLD) {
    const inc = safeUnit === 'lb' ? INCREMENT_LB : INCREMENT_KG;
    const next = roundToPlate(lastWeight + inc, safeUnit);
    return {
      nextWeight: next,
      rationale: 'increment',
      reason: `Last session: ${Math.round(fqi)}% FQI → try +${inc} ${safeUnit}`,
    };
  }

  if (fqi < FQI_DELOAD_THRESHOLD) {
    const next = roundToPlate(lastWeight * DELOAD_RATIO, safeUnit);
    return {
      nextWeight: next,
      rationale: 'deload',
      reason: `Last session: ${Math.round(fqi)}% FQI → deload (-10%)`,
    };
  }

  return {
    nextWeight: lastWeight,
    rationale: 'maintain',
    reason: `Last session: ${Math.round(fqi)}% FQI → maintain`,
  };
}
